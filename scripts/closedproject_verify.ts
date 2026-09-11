/**
 * Completed-project read-only rule — behaviour against the real database.
 *
 * Each case is paired: the same write must SUCCEED on an open project and be
 * REFUSED on a completed one. An absence assertion on its own would pass just as
 * well if the write were broken for everybody.
 *
 * Run: npx tsx scripts/closedproject_verify.ts
 */
import { prisma } from '../lib/prisma';
import {
  ProjectClosedError,
  CLOSED_PROJECT_WRITABLE_MODELS,
  runProjectLifecycleWrite,
  invalidateClosedProjectCache,
} from '../services/projectClosure/projectWritable';

let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

async function refused(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return e instanceof ProjectClosedError; }
}
async function succeeded(fn: () => Promise<unknown>): Promise<string | true> {
  try { await fn(); return true; }
  catch (e) { return (e as Error).message.slice(0, 90); }
}

const made = { sites: [] as string[], workers: [] as string[] };

async function makeSite(name: string, status: 'ACTIVE' | 'COMPLETED') {
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const s = await prisma.jobSite.create({
    data: {
      name, addressLine1: '1 Test Way', town: 'Testville', postcode: 'TE1 1ST',
      jobReference: `CP-${process.pid}-${made.sites.length}`, createdByAdminId: admin!.id,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  made.sites.push(s.id);
  if (status === 'COMPLETED') {
    await runProjectLifecycleWrite(() =>
      prisma.jobSite.update({ where: { id: s.id }, data: { status: 'COMPLETED', completedAt: new Date() } }));
  }
  invalidateClosedProjectCache();
  return s.id;
}

async function main() {
  console.log('== COMPLETED PROJECT — READ-ONLY RULE ==\n');
  const open = await makeSite('CP Open', 'ACTIVE');
  const shut = await makeSite('CP Completed', 'COMPLETED');
  const worker = await prisma.worker.create({
    data: { mobile: `+4477009${String(process.pid).slice(-5).padStart(5,'0')}`, fullName: 'CP Tester', company: 'T' },
  });
  made.workers.push(worker.id);

  console.log('[1] A site-scoped model (SiteInductionConfig) — the case that already worked');
  chk('open project accepts the write',
      (await succeeded(() => prisma.siteInductionConfig.upsert({
        where: { jobSiteId: open }, create: { jobSiteId: open, inductionValidityDays: 91 },
        update: { inductionValidityDays: 91 } }))) === true);
  chk('completed project refuses it',
      await refused(() => prisma.siteInductionConfig.upsert({
        where: { jobSiteId: shut }, create: { jobSiteId: shut, inductionValidityDays: 91 },
        update: { inductionValidityDays: 91 } })));

  console.log('\n[2] JobSite itself — the row the guard could not see');
  chk('open project accepts an emergency-info edit',
      (await succeeded(() => prisma.jobSite.update({
        where: { id: open }, data: { fireAssemblyPoint: 'Car park' } }))) === true);
  chk('completed project now REFUSES it',
      await refused(() => prisma.jobSite.update({
        where: { id: shut }, data: { fireAssemblyPoint: 'Car park' } })),
      'saving emergency info / GPS config used to return 200 and persist');
  chk('an updateMany naming the site is refused too',
      await refused(() => prisma.jobSite.updateMany({
        where: { id: { in: [shut] } }, data: { fireAssemblyPoint: 'x' } })));

  console.log('\n[3] Operative assignments — allow-listed, so invites got through');
  chk('WorkerSiteAssignment is no longer allow-listed',
      !CLOSED_PROJECT_WRITABLE_MODELS.has('WorkerSiteAssignment'));
  chk('open project accepts an invite',
      (await succeeded(() => prisma.workerSiteAssignment.create({
        data: { jobSiteId: open, workerId: worker.id, status: 'ACTIVE' } }))) === true);
  chk('completed project now REFUSES an invite',
      await refused(() => prisma.workerSiteAssignment.create({
        data: { jobSiteId: shut, workerId: worker.id, status: 'ACTIVE' } })),
      'this used to return HTTP 200 and create a live assignment');

  console.log('\n[4] Closure and reopening must still work');
  chk('the lifecycle bypass can still write a completed project',
      (await succeeded(() => runProjectLifecycleWrite(() => prisma.$transaction([
        prisma.jobSite.update({ where: { id: shut }, data: { completedByName: 'Test' } }),
        prisma.workerSiteAssignment.updateMany({ where: { jobSiteId: shut }, data: { status: 'SUSPENDED' } }),
      ])))) === true,
      'closure suspends assignments; reopening restores them');
  chk('the bypass holds for a PLAIN write, not just $transaction([...])',
      (await succeeded(() => runProjectLifecycleWrite(() =>
        prisma.jobSite.update({ where: { id: shut }, data: { completedByName: 'Test 2' } })))) === true,
      'a Prisma call is lazy, so returning it from run() used to leave the scope first');

  console.log('\n[5] The close-out pack stays available after completion');
  chk('CloseOutPack is still allow-listed', CLOSED_PROJECT_WRITABLE_MODELS.has('CloseOutPack'));
  chk('SiteClosureEvent is still allow-listed', CLOSED_PROJECT_WRITABLE_MODELS.has('SiteClosureEvent'));

  console.log('\n[6] Reads are never blocked');
  chk('a completed project still reads',
      (await succeeded(() => prisma.jobSite.findUnique({ where: { id: shut } }))) === true);
  chk('its roster still reads',
      (await succeeded(() => prisma.workerSiteAssignment.findMany({ where: { jobSiteId: shut } }))) === true);

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await runProjectLifecycleWrite(async () => {
    for (const id of made.sites) {
      await prisma.workerAssignmentEvent.deleteMany({ where: { jobSiteId: id } });
      await prisma.workerSiteAssignment.deleteMany({ where: { jobSiteId: id } });
      await prisma.siteInductionConfig.deleteMany({ where: { jobSiteId: id } });
      await prisma.jobSite.deleteMany({ where: { id } });
    }
    for (const id of made.workers) await prisma.worker.deleteMany({ where: { id } });
  });
  invalidateClosedProjectCache();
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
