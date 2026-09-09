/**
 * Report attribution — a report must record the experience it was filed FROM and
 * the account that filed it there, even when one browser holds several sessions.
 *
 * Runs against the real service and the real database. The HTTP layer is stood in
 * for by calling resolveReporter/createIssueReport directly with cookies stubbed,
 * because the thing under test is WHICH SESSION IS READ — and that is decided
 * before any browser is involved.
 *
 * Run: npx tsx scripts/reportattribution_verify.ts
 */
import { IssueReportPortal, IssueReportType } from '@prisma/client';

// The session helpers read cookies() from next/headers, which does not exist
// outside a request. Stub it BEFORE the service is imported so the module graph
// picks up the stub. This is the seam the whole bug lived behind.
const jar: Record<string, string> = {};
require.cache[require.resolve('next/headers')] = {
  id: 'next/headers', filename: 'next/headers', loaded: true, exports: {
    cookies: () => ({
      get: (n: string) => (jar[n] ? { name: n, value: jar[n] } : undefined),
      set: () => {}, delete: () => {},
    }),
  },
} as never;

const { prisma } = require('../lib/prisma');
const { createPlatformSessionToken, createWorkerSessionToken, createAdminSessionToken } = require('../lib/session');
const { resolveReporter, createIssueReport } = require('../services/reports/reportService');

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const created: string[] = [];

async function main() {
  console.log('== REPORT ATTRIBUTION ==\n');

  const worker = await prisma.worker.findFirst({ select: { id: true, fullName: true, mobile: true } });
  const puser = await prisma.platformUser.findFirst({ select: { id: true, name: true, email: true } });
  if (!worker || !puser) { console.log('  ABORT: need one worker and one platform user locally'); process.exit(1); }
  console.log(`  worker:   ${worker.fullName} (${worker.mobile})`);
  console.log(`  platform: ${puser.name} <${puser.email}>\n`);

  // THE SCENARIO: one browser, both sessions. A site manager who is also on site.
  jar['sc_platform'] = createPlatformSessionToken({ userId: puser.id, email: puser.email, name: puser.name, role: 'DIRECTOR' });
  jar['sc_worker'] = createWorkerSessionToken({ mobile: worker.mobile, workerId: worker.id, fullName: worker.fullName });
  console.log('[1] One browser holding BOTH a platform and a worker session');

  const asWorker = await resolveReporter(IssueReportPortal.WORKER);
  chk('filing from the Worker Portal resolves the WORKER', asWorker?.portal === IssueReportPortal.WORKER, `${asWorker?.portal} / ${asWorker?.name}`);
  chk('...and names the worker, not the manager', asWorker?.name === worker.fullName, `${asWorker?.name}`);

  const asPlatform = await resolveReporter(IssueReportPortal.PLATFORM);
  chk('filing from Platform resolves the PLATFORM user', asPlatform?.portal === IssueReportPortal.PLATFORM, `${asPlatform?.portal} / ${asPlatform?.name}`);

  chk('the two are DIFFERENT rate-limit identities', asWorker!.ref !== asPlatform!.ref, `${asWorker!.ref} vs ${asPlatform!.ref}`);
  chk('the ref says which portal it belongs to', asWorker!.ref.startsWith('worker:') && asPlatform!.ref.startsWith('platform:'));

  console.log('\n[2] The stored row matches where it was filed');
  const w = await createIssueReport(asWorker!, { type: IssueReportType.BUG, description: 'Filed from the worker dashboard while also signed in to Platform.', contactRequested: false, pagePath: '/worker/dashboard' }, 'attribution-verify');
  chk('a worker report is accepted', w.ok === true, w.ok ? w.reference : w.error);
  if (w.ok) {
    created.push(w.id);
    const row = await prisma.issueReport.findUnique({ where: { id: w.id } });
    chk('stored as portal=WORKER', row.portal === IssueReportPortal.WORKER, row.portal);
    chk('stored against the worker', row.reporterName === worker.fullName, row.reporterName);
    // Compare the two, rather than asserting the page path alone — that passed
    // on the buggy code, where portal was PLATFORM and the page was /worker.
    const expected = row.pagePath.startsWith('/worker') ? IssueReportPortal.WORKER
      : row.pagePath.startsWith('/admin') ? IssueReportPortal.ADMIN : IssueReportPortal.PLATFORM;
    chk('portal and page agree', row.portal === expected, `${row.portal} + ${row.pagePath}`);
  }

  console.log('\n[3] The cooldown no longer leaks across experiences');
  // The worker just filed. The manager must still be able to file immediately.
  const p = await createIssueReport(asPlatform!, { type: IssueReportType.FEEDBACK, description: 'Filed from Platform immediately after the worker report.', contactRequested: false, pagePath: '/platform/dashboard/submissions' }, 'attribution-verify');
  chk('a Platform report straight after a Worker one is NOT blocked', p.ok === true, p.ok ? p.reference : p.error);
  if (p.ok) created.push(p.id);
  // ...but the SAME identity twice still is.
  const again = await createIssueReport(asPlatform!, { type: IssueReportType.FEEDBACK, description: 'A second Platform report within the minute, which must be refused.', contactRequested: false, pagePath: '/platform/dashboard/submissions' }, 'attribution-verify');
  chk('the same identity twice in a minute IS still blocked', again.ok === false && Boolean(again.retryAfterSeconds), again.ok ? 'it was allowed' : again.error);

  console.log('\n[4] The portal is a cookie selector, never a claim of identity');
  delete jar['sc_platform'];
  const spoof = await resolveReporter(IssueReportPortal.PLATFORM);
  chk('asking for a portal you hold no session for is refused', spoof === null, String(spoof));
  const stillWorker = await resolveReporter(IssueReportPortal.WORKER);
  chk('...and the worker session is unaffected', stillWorker?.portal === IssueReportPortal.WORKER);

  console.log('\n[5] Admin is resolved on its own terms');
  jar['sc_admin'] = createAdminSessionToken({ adminId: 'attr-test', email: 'a@test.invalid', name: 'Admin Tester', role: 'SUPER_ADMIN' });
  const asAdmin = await resolveReporter(IssueReportPortal.ADMIN);
  chk('filing from Admin resolves the ADMIN', asAdmin?.portal === IssueReportPortal.ADMIN, `${asAdmin?.name}`);
  chk('even though a worker session is also present', (await resolveReporter(IssueReportPortal.WORKER))?.portal === IssueReportPortal.WORKER);

  console.log('\n[6] A STALE client, sending no portal — the case that kept the bug alive');
  // Restore both sessions; [4] and [5] left the jar in a different state.
  jar['sc_platform'] = createPlatformSessionToken({ userId: puser.id, email: puser.email, name: puser.name, role: 'DIRECTOR' });
  jar['sc_worker'] = createWorkerSessionToken({ mobile: worker.mobile, workerId: worker.id, fullName: worker.fullName });
  delete jar['sc_admin'];

  const staleWorker = await resolveReporter(undefined, '/worker/dashboard');
  chk('a worker PAGE resolves the worker even with no portal field',
      staleWorker?.portal === IssueReportPortal.WORKER, `${staleWorker?.portal} / ${staleWorker?.name}`);
  const stalePlatform = await resolveReporter(undefined, '/platform/dashboard/submissions');
  chk('a platform PAGE resolves the platform user',
      stalePlatform?.portal === IssueReportPortal.PLATFORM, `${stalePlatform?.portal} / ${stalePlatform?.name}`);
  chk('so a stale client ALSO gets two separate cooldown buckets',
      staleWorker!.ref !== stalePlatform!.ref, `${staleWorker!.ref} vs ${stalePlatform!.ref}`);
  const staleWithQuery = await resolveReporter(undefined, '/worker/permits?status=open');
  chk('a query string does not defeat the inference', staleWithQuery?.portal === IssueReportPortal.WORKER);
  const unknownPath = await resolveReporter(undefined, '/something/else');
  chk('an unrecognised path still resolves someone rather than failing', unknownPath !== null, `${unknownPath?.portal}`);

  console.log('\n[7] Inference never grants a session you do not hold');
  delete jar['sc_worker'];
  const noWorker = await resolveReporter(undefined, '/worker/dashboard');
  chk('a worker page with no worker session falls back, it does not invent one',
      noWorker?.portal === IssueReportPortal.PLATFORM, `${noWorker?.portal}`);
  const explicitWorker = await resolveReporter(IssueReportPortal.WORKER, '/worker/dashboard');
  chk('but an EXPLICIT worker portal with no worker session is refused', explicitWorker === null, String(explicitWorker));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { for (const f of failures) console.log(`   FAILED: ${f}`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (created.length) {
    const r = await prisma.issueReport.deleteMany({ where: { id: { in: created } } });
    console.log(`   cleaned up ${r.count} verification rows`);
  }
  await prisma.$disconnect();
});
