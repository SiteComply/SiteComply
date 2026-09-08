/**
 * Issue reports Phase 2 — delivery verification.
 *
 * Runs the REAL delivery service against the REAL local database, with the
 * transport injected. That split is the point: everything with a decision in it
 * — the retry policy, the status transitions, the duplicate guard, the
 * disabled-means-off rule — is exercised for real, and only the HTTPS call to
 * Graph is stood in for. The transport itself cannot be proved here at all; it
 * is proved in production against the actual mailbox, once credentials exist.
 *
 * Run: npx tsx scripts/reportdelivery_verify.ts
 */
import { IssueReportDelivery, IssueReportPortal, IssueReportType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  MAX_ATTEMPTS,
  bodyFor,
  deliverPendingReports,
  deliverReport,
  subjectFor,
  type Sender,
} from '../services/reports/reportDelivery';
import { MailError, mailerConfig, mailerEnabled } from '../services/reports/reportMailer';
import type { Mail } from '../services/reports/reportMailer';

let pass = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const CONFIG = {
  REPORT_MAIL_TENANT_ID: 'tenant-for-verification',
  REPORT_MAIL_CLIENT_ID: 'client-for-verification',
  REPORT_MAIL_CLIENT_SECRET: 'secret-for-verification',
  REPORT_MAIL_FROM: 'tech@example.invalid',
  REPORT_MAIL_TO: 'tech@example.invalid',
};

function enableMail() {
  for (const [k, v] of Object.entries(CONFIG)) process.env[k] = v;
}
function disableMail() {
  for (const k of Object.keys(CONFIG)) delete process.env[k];
}

/** A fresh report row, owned by this script so nothing real is touched. */
async function seed(overrides: Record<string, unknown> = {}) {
  return prisma.issueReport.create({
    data: {
      type: IssueReportType.BUG,
      description: 'The check-out button does nothing on my phone <b>at all</b>.',
      portal: IssueReportPortal.WORKER,
      // Unique per row: the rate limit counts on reporterRef, and reusing one
      // would have these rows throttling each other rather than testing delivery.
      reporterRef: `verify:${process.pid}:${seq++}`,
      reporterName: 'Delivery Verification',
      reporterRole: 'Operative',
      reporterOrg: 'Verification Ltd',
      pagePath: '/worker/dashboard',
      pageTitle: 'Dashboard',
      userAgent: 'verification-script',
      browser: 'Chrome',
      os: 'Android',
      deviceType: 'Mobile',
      viewportWidth: 390,
      viewportHeight: 844,
      ...overrides,
    },
  });
}

async function status(id: string) {
  const r = await prisma.issueReport.findUniqueOrThrow({ where: { id } });
  return {
    status: r.deliveryStatus,
    attempts: r.deliveryAttempts,
    error: r.deliveryLastError,
    deliveredAt: r.deliveredAt,
  };
}

const created: string[] = [];
let seq = 0;

async function main() {
  console.log('== ISSUE REPORT DELIVERY VERIFICATION ==\n');

  // --- 1. Off means off ------------------------------------------------------
  console.log('[1] With no mail configuration');
  disableMail();
  check('mail reports itself as not configured', !mailerEnabled() && mailerConfig() === null);

  const offRow = await seed();
  created.push(offRow.id);
  let sent = 0;
  const counting: Sender = async () => {
    sent += 1;
  };
  const offOutcome = await deliverReport(offRow.id, counting);
  const off = await status(offRow.id);
  check('a report is marked DISABLED, not failed', off.status === IssueReportDelivery.DISABLED, offOutcome);
  check('no attempt is consumed while mail is off', off.attempts === 0, `attempts=${off.attempts}`);
  check('nothing was sent', sent === 0);

  const offSweep = await deliverPendingReports(50, counting);
  check('the sweep is a no-op while mail is off', offSweep.disabled && offSweep.considered === 0);

  // --- 2. The happy path -----------------------------------------------------
  console.log('\n[2] With mail configured');
  enableMail();
  check('mail reports itself as configured', mailerEnabled());

  const okRow = await seed({ type: IssueReportType.FEEDBACK, portal: IssueReportPortal.PLATFORM });
  created.push(okRow.id);
  const outbox: Mail[] = [];
  const capture: Sender = async (mail) => {
    outbox.push(mail);
  };
  const okOutcome = await deliverReport(okRow.id, capture);
  const ok = await status(okRow.id);
  check('a report is SENT', ok.status === IssueReportDelivery.SENT, okOutcome);
  check('the attempt is counted', ok.attempts === 1);
  check('deliveredAt is stamped', ok.deliveredAt !== null);
  check('exactly one email was produced', outbox.length === 1);

  const mail = outbox[0]!;
  check(
    'the subject leads with the reference',
    mail.subject.includes(okRow.reference) && mail.subject.startsWith('[SiteComply]'),
    mail.subject,
  );
  check('the subject names the type and the experience', /Feedback from Platform/.test(mail.subject));
  check('the body carries what they wrote', mail.text.includes('does nothing on my phone'));
  check('the body carries the page', mail.text.includes('/worker/dashboard'));
  check('the body carries the device', mail.text.includes('390×844'));

  // --- 3. The description is escaped, not rendered ---------------------------
  console.log('\n[3] Report text is treated as text');
  const xssRow = await seed({
    description: 'Broken <script>alert(1)</script> & the "quotes" too, please fix.',
    reporterName: 'Bob <b>Tag</b>',
  });
  created.push(xssRow.id);
  const xss = bodyFor(await prisma.issueReport.findUniqueOrThrow({ where: { id: xssRow.id } }));
  check('script tags are escaped in the HTML body', !xss.html.includes('<script>') && xss.html.includes('&lt;script&gt;'));
  check('ampersands and quotes are escaped', xss.html.includes('&amp;') && xss.html.includes('&quot;'));
  check('a reporter name cannot inject markup', !xss.html.includes('<b>Tag</b>'));

  // --- 4. Retryable failure --------------------------------------------------
  console.log('\n[4] A retryable failure');
  const retryRow = await seed();
  created.push(retryRow.id);
  const throttled: Sender = async () => {
    throw new MailError('Graph sendMail returned 429: throttled', true);
  };
  const retryOutcome = await deliverReport(retryRow.id, throttled);
  const retry = await status(retryRow.id);
  check('stays PENDING so the sweep will retry', retry.status === IssueReportDelivery.PENDING, retryOutcome);
  check('the attempt is counted', retry.attempts === 1);
  check('the reason is recorded', (retry.error ?? '').includes('429'));

  // --- 5. Permanent failure --------------------------------------------------
  console.log('\n[5] A permanent failure');
  const deadRow = await seed();
  created.push(deadRow.id);
  const refused: Sender = async () => {
    throw new MailError('Graph sendMail returned 403: no access policy', false);
  };
  const deadOutcome = await deliverReport(deadRow.id, refused);
  const dead = await status(deadRow.id);
  check('goes straight to FAILED without burning five hours', dead.status === IssueReportDelivery.FAILED, deadOutcome);
  check('the reason is recorded', (dead.error ?? '').includes('403'));

  // --- 6. Attempts are bounded ----------------------------------------------
  console.log('\n[6] Retries are bounded');
  const boundRow = await seed();
  created.push(boundRow.id);
  for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await deliverReport(boundRow.id, throttled);
  const bound = await status(boundRow.id);
  check('gives up at MAX_ATTEMPTS', bound.status === IssueReportDelivery.FAILED, `attempts=${bound.attempts}`);
  check('never exceeds MAX_ATTEMPTS', bound.attempts === MAX_ATTEMPTS, `${bound.attempts} vs ${MAX_ATTEMPTS}`);

  // --- 7. No duplicates ------------------------------------------------------
  console.log('\n[7] The same report is never sent twice');
  outbox.length = 0;
  const dupOutcome = await deliverReport(okRow.id, capture);
  check('an already-SENT report is skipped', dupOutcome === 'skipped' && outbox.length === 0);
  const failOutcome = await deliverReport(deadRow.id, capture);
  check('a FAILED report is not retried by a later sweep', failOutcome === 'skipped' && outbox.length === 0);

  // --- 8. The sweep picks up the backlog ------------------------------------
  console.log('\n[8] Switching mail on delivers the backlog');
  const swept: Mail[] = [];
  const sweepSender: Sender = async (m) => {
    swept.push(m);
  };
  const sweep = await deliverPendingReports(50, sweepSender);
  const offAfter = await status(offRow.id);
  check(
    'the report stored while mail was off is now SENT',
    offAfter.status === IssueReportDelivery.SENT,
    `swept ${sweep.sent} of ${sweep.considered}`,
  );
  check('the retryable one was retried too', (await status(retryRow.id)).status === IssueReportDelivery.SENT);
  check('the sweep reports mail as enabled', sweep.disabled === false);

  // --- 9. The sweep is bounded ----------------------------------------------
  // NOT "nothing else was touched": sweeping every pending report is exactly
  // what this is for, so an untouched-rows assertion would be either vacuous or
  // wrong. What matters is that one run cannot send an unbounded burst.
  console.log('\n[9] One sweep cannot flood the mailbox');
  const burst: string[] = [];
  for (let i = 0; i < 5; i++) burst.push((await seed()).id);
  created.push(...burst);
  const capped: Mail[] = [];
  const limited = await deliverPendingReports(2, async (m) => {
    capped.push(m);
  });
  check('the sweep honours its limit', limited.considered === 2 && capped.length === 2, `considered=${limited.considered} sent=${capped.length}`);
  const stillPending = await prisma.issueReport.count({
    where: { id: { in: burst }, deliveryStatus: IssueReportDelivery.PENDING },
  });
  check('the rest are left for the next run', stillPending === 3, `${stillPending} still pending`);

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    for (const f of failures) console.log(`   FAILED: ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // The script owns every row it made. Leave the database as it was found.
    if (created.length) {
      const removed = await prisma.issueReport.deleteMany({ where: { id: { in: created } } });
      console.log(`   cleaned up ${removed.count} verification rows`);
    }
    await prisma.$disconnect();
  });
