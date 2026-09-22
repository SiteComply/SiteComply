/**
 * "Check this card with CSCS now" - who may use it, and on whom.
 *
 * THE DEFECT: the route asked for checkins:'edit', which no role holds (every
 * role is V or VX on check-ins), so it refused EVERYONE while the record page
 * offered the button to anyone who could open it. It had never worked.
 *
 * Now: 'export' - the verb that already shows an operative's mobile - AND the
 * operative must be inside the viewer's sites, exactly as the record page
 * requires. Looked up by id alone, a widened permission would have let a
 * manager ask CSCS about any operative by guessing an id.
 *
 * CSCS is never called: the stored config is stubbed as incomplete, so a viewer
 * who gets past both gates receives "credentials are not complete" - which is
 * precisely the proof that they got past them.
 *
 * Run: npx tsx scripts/cscs_checknow_access_verify.ts
 */
let viewer: any = null;
const accessPath = require.resolve('../services/platformUsers/platformAccess');
// Stubbed WITHOUT loading the real module: it needs React's server runtime.
require.cache[accessPath] = {
  id: accessPath, filename: accessPath, loaded: true,
  exports: { requirePlatformViewer: async () => viewer, getPlatformViewer: async () => viewer },
} as never;
const cfgPath = require.resolve('../services/cscs/cscsConfigService');
const realCfg = require(cfgPath);
require.cache[cfgPath] = {
  id: cfgPath, filename: cfgPath, loaded: true,
  exports: { ...realCfg, getCscsRuntimeConfig: async () => ({
    providerId: 'smartcheck', verificationEnabled: true, apiUrl: null, apiKey: null,
    username: null, password: null, source: 'database' }) },
} as never;

const { prisma } = require('../lib/prisma');
const { POST } = require('../app/api/platform/workers/[id]/cscs-check/route');

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};
const MOBILE = '+447700900961';

async function call(v: any, id: string) {
  viewer = v;
  const res = await POST(new Request('http://x/api') as never, { params: { id } });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log('== CHECK THIS CARD NOW: PERMISSION AND SCOPE ==\n');
  const [siteA, siteB] = await prisma.jobSite.findMany({ take: 2, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
  if (!siteA || !siteB) { console.log('  ABORT: need two local sites'); process.exit(1); }
  const old = await prisma.worker.findUnique({ where: { mobile: MOBILE } });
  if (old) { await prisma.submission.deleteMany({ where: { workerId: old.id } }); await prisma.worker.delete({ where: { id: old.id } }); }
  const w = await prisma.worker.create({ data: {
    mobile: MOBILE, fullName: 'Scope Test', firstName: 'Scope', surname: 'Test', company: 'T',
    cscsCardNumber: '99999999', cscsSchemeId: 'C4T' } });
  await prisma.submission.create({ data: { workerId: w.id, jobSiteId: siteA.id, checklistVersion: 1,
    answers: {}, status: 'COMPLIANT', gdprConsent: true } });
  const logsBefore = await prisma.cscsVerificationLog.count({ where: { workerId: w.id } });
  const as = (role: string, siteIds: string[]) => ({ id: 'v', name: 'V', role, siteIds });
  const passedGates = (r: any) => r.status === 200 && /credentials are not complete/.test(r.body.error ?? '');

  try {
    for (const role of ['DIRECTOR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'AUDITOR', 'HS_CONSULTANT', 'PRINCIPAL_CONTRACTOR']) {
      const r = await call(as(role, [siteA.id]), w.id);
      chk(`${role} on the operative's site may run the check`, passedGates(r), `${r.status} ${r.body.error}`);
    }
    for (const role of ['ENGINEER', 'CLIENT']) {
      const r = await call(as(role, [siteA.id]), w.id);
      chk(`${role} is refused (view-only on check-ins)`, r.status === 403, `${r.status} ${r.body.error}`);
    }
    const out = await call(as('PROJECT_MANAGER', [siteB.id]), w.id);
    chk('a manager on ANOTHER site is refused as not found', out.status === 404, `${out.status} ${out.body.error}`);
    const none = await call(as('SITE_MANAGER', []), w.id);
    chk('a viewer with no sites is refused as not found', none.status === 404, `${none.status}`);
    const ghost = await call(as('DIRECTOR', [siteA.id]), 'no-such-worker');
    chk('an unknown id is not found', ghost.status === 404, `${ghost.status}`);
    chk('no refused call wrote an audit row',
        (await prisma.cscsVerificationLog.count({ where: { workerId: w.id } })) === logsBefore);

    const fs = require('fs');
    const page = fs.readFileSync('app/platform/dashboard/workers/[id]/page.tsx', 'utf8');
    chk('the page offers the button only where the route will honour it',
        /worker\.cscsCardNumber && canSeeMobile && \(\s*\n?\s*<CscsCheckNowButton/.test(page));
  } finally {
    await prisma.submission.deleteMany({ where: { workerId: w.id } });
    await prisma.cscsVerificationLog.deleteMany({ where: { workerId: w.id } });
    await prisma.worker.delete({ where: { id: w.id } });
    await prisma.$disconnect();
  }
  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main().catch(async (e) => { console.error(e); process.exitCode = 1; });
