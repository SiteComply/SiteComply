import type { IssueReport } from '@prisma/client';
import { IssueReportDelivery } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MailError, mailerConfig, sendMail, type Mail } from './reportMailer';

/**
 * Issue reports (Phase 2): delivery policy.
 *
 * What the email says, when it is retried, and what is recorded about it. The
 * row remains the record — this layer never fails a report and never changes
 * one's content. If mail is off, misconfigured or permanently rejected, the
 * report is still exactly as complete as it was in Phase 1.
 */

/**
 * Five attempts, one per hourly sweep, so a transient Graph outage or a throttle
 * has most of a working morning to clear. Deliberately NOT backed by a
 * next-attempt-at column: the sweep's own cadence is the backoff, which keeps
 * Phase 2 free of a second migration.
 */
export const MAX_ATTEMPTS = 5;

const TYPE_LABEL: Record<string, string> = {
  BUG: 'Bug report',
  FEEDBACK: 'Feedback',
  SUGGESTION: 'Suggestion',
};

const PORTAL_LABEL: Record<string, string> = {
  PLATFORM: 'Platform',
  ADMIN: 'Admin Centre',
  WORKER: 'Worker Portal',
};

export function subjectFor(report: IssueReport): string {
  const type = TYPE_LABEL[report.type] ?? report.type;
  const portal = PORTAL_LABEL[report.portal] ?? report.portal;
  // Reference first: it is what a reply will quote and what the sender was told.
  return `[SiteComply] ${report.reference} — ${type} from ${portal}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The rows under "Where it happened" and "Who sent it", in reading order. */
function detailRows(report: IssueReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Reference', report.reference],
    ['Type', TYPE_LABEL[report.type] ?? report.type],
    ['Experience', PORTAL_LABEL[report.portal] ?? report.portal],
    ['Sent', report.createdAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
    ['From', `${report.reporterName} (${report.reporterRole})`],
  ];
  if (report.reporterOrg) rows.push(['Organisation', report.reporterOrg]);
  rows.push([
    'Reply to',
    report.contactRequested && report.reporterEmail
      ? report.reporterEmail
      : 'Not requested — do not reply directly',
  ]);
  rows.push(['Page', report.pageTitle ? `${report.pageTitle} (${report.pagePath})` : report.pagePath]);
  if (report.activeSiteName) rows.push(['Site', report.activeSiteName]);

  const device = [report.deviceType, report.browser, report.os].filter(Boolean).join(' · ');
  const viewport =
    report.viewportWidth && report.viewportHeight
      ? `${report.viewportWidth}×${report.viewportHeight}`
      : null;
  if (device || viewport) {
    rows.push(['Device', [device, viewport].filter(Boolean).join(' — ') || 'Unknown']);
  }
  if (report.buildId) rows.push(['Build', report.buildId]);
  return rows;
}

/**
 * Deliberately plain HTML with inline styles: this is read in Outlook, where a
 * stylesheet is a coin toss and a table is the only layout that behaves.
 */
export function bodyFor(report: IssueReport): { html: string; text: string } {
  const rows = detailRows(report);

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2933;max-width:640px">
<p style="margin:0 0 4px;font-size:12px;color:#6b7785;text-transform:uppercase;letter-spacing:.06em">${esc(
    PORTAL_LABEL[report.portal] ?? report.portal,
  )}</p>
<h2 style="margin:0 0 16px;font-size:18px;color:#0f172a">${esc(
    TYPE_LABEL[report.type] ?? report.type,
  )} — ${esc(report.reference)}</h2>
<div style="border-left:3px solid #38B54A;padding:2px 0 2px 14px;margin:0 0 20px;white-space:pre-wrap">${esc(
    report.description,
  )}</div>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:3px 16px 3px 0;color:#6b7785;vertical-align:top;white-space:nowrap">${esc(
        k,
      )}</td><td style="padding:3px 0;color:#1f2933">${esc(v)}</td></tr>`,
  )
  .join('\n')}
</table>
<p style="margin:20px 0 0;font-size:12px;color:#98a2b3">Sent by SiteComply. The full report is stored against ${esc(
    report.reference,
  )}.</p>
</div>`;

  const text = [
    `${TYPE_LABEL[report.type] ?? report.type} — ${report.reference}`,
    '',
    report.description,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join('\n');

  return { html, text };
}

export type DeliveryOutcome = 'sent' | 'retrying' | 'failed' | 'disabled' | 'skipped';

/**
 * The transport, injectable. Production always uses the default; the seam exists
 * so the status transitions below — the part with the retry policy in it — can
 * be exercised against a real database without a real mailbox, and so this file
 * stays honestly independent of Graph.
 */
export type Sender = (mail: Mail) => Promise<void>;

/**
 * Attempt one report. Safe to call twice — an already-SENT row is skipped rather
 * than sent again, which is what makes the inline attempt and the hourly sweep
 * able to race without duplicating mail.
 */
export async function deliverReport(id: string, send: Sender = sendMail): Promise<DeliveryOutcome> {
  const report = await prisma.issueReport.findUnique({ where: { id } });
  if (!report) return 'skipped';
  if (report.deliveryStatus === IssueReportDelivery.SENT) return 'skipped';
  if (report.deliveryStatus === IssueReportDelivery.FAILED) return 'skipped';

  if (!mailerConfig()) {
    // Off, not broken. No attempt is counted, so switching mail on later gives
    // the backlog its full five tries.
    if (report.deliveryStatus !== IssueReportDelivery.DISABLED) {
      await prisma.issueReport.update({
        where: { id },
        data: { deliveryStatus: IssueReportDelivery.DISABLED },
      });
    }
    return 'disabled';
  }

  const { html, text } = bodyFor(report);

  try {
    await send({
      subject: subjectFor(report),
      html,
      text,
      replyTo: report.contactRequested ? report.reporterEmail : null,
    });
  } catch (err) {
    const attempts = report.deliveryAttempts + 1;
    const retryable = err instanceof MailError ? err.retryable : true;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const giveUp = !retryable || exhausted;

    await prisma.issueReport.update({
      where: { id },
      data: {
        deliveryStatus: giveUp ? IssueReportDelivery.FAILED : IssueReportDelivery.PENDING,
        deliveryAttempts: attempts,
        deliveryLastError: message(err).slice(0, 500),
      },
    });
    return giveUp ? 'failed' : 'retrying';
  }

  await prisma.issueReport.update({
    where: { id },
    data: {
      deliveryStatus: IssueReportDelivery.SENT,
      deliveryAttempts: report.deliveryAttempts + 1,
      deliveredAt: new Date(),
      deliveryLastError: null,
    },
  });
  return 'sent';
}

/**
 * Fire-and-forget from the request path. Delivery must never make a submission
 * slower or turn a stored report into an error the reporter sees — the sweep is
 * the safety net if this is cut short.
 */
export function deliverInBackground(id: string): void {
  void deliverReport(id).catch(() => {
    // deliverReport already records the failure on the row; there is nothing
    // useful left to do here and an unhandled rejection would be noise.
  });
}

export interface SweepResult {
  considered: number;
  sent: number;
  retrying: number;
  failed: number;
  disabled: boolean;
}

/**
 * The hourly catch-up. Picks up anything the inline attempt missed — a restart
 * mid-send, a Graph outage, or the whole backlog stored while mail was off.
 */
export async function deliverPendingReports(
  limit = 25,
  send: Sender = sendMail,
): Promise<SweepResult> {
  if (!mailerConfig()) {
    return { considered: 0, sent: 0, retrying: 0, failed: 0, disabled: true };
  }

  const due = await prisma.issueReport.findMany({
    where: {
      // DISABLED is included on purpose: those are reports stored before mail
      // was switched on, and they have never had an attempt.
      deliveryStatus: { in: [IssueReportDelivery.PENDING, IssueReportDelivery.DISABLED] },
      deliveryAttempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const result: SweepResult = {
    considered: due.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    disabled: false,
  };

  // Sequential: Graph throttles per mailbox, and a backlog is small by nature.
  for (const { id } of due) {
    const outcome = await deliverReport(id, send);
    if (outcome === 'sent') result.sent += 1;
    else if (outcome === 'retrying') result.retrying += 1;
    else if (outcome === 'failed') result.failed += 1;
  }

  return result;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
