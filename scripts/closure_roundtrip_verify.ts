/**
 * Close → reopen, through the real services.
 *
 * This is the regression that matters most: the read-only guard now covers
 * JobSite itself and no longer allow-lists operative assignments, and the
 * lifecycle bypass changed shape. If any of that were wrong, closing a project
 * would half-apply or reopening would be impossible — and reopening is the only
 * way back.
 *
 * Run: npx tsx scripts/closure_roundtrip_verify.ts
 */
import { prisma } from '../lib/prisma';
import { closeProject, reopenProject } from '../services/projectClosure/closureService';
import { runProjectLifecycleWrite, invalidateClosedProjectCache } from '../services/projectClosure/projectWritable';

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const made = { sites: [] as string[], workers: [] as string[] };

async function main() {
  console.log('== CLOSE → REOPEN ROUND TRIP ==\n');
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const site = await prisma.jobSite.create({
    data: { name: 'ZZ Roundtrip', addressLine1: '1', town: 'T', postcode: 'TE1 1ST',
            jobReference: `ZZ-RT-${process.pid}`, createdByAdminId: admin!.id, status: 'ACTIVE' },
    select: { id: true } });
  made.sites.push(site.id);
  const w = await prisma.worker.create({
    data: { mobile: `+4477008${String(process.pid).slice(-5).padStart(5,'0')}`, fullName: 'RT Tester', company: 'T' } });
  made.workers.push(w.id);
  const asg = await prisma.workerSiteAssignment.create({
    data: { jobSiteId: site.id, workerId: w.id, status: 'ACTIVE' } });
  invalidateClosedProjectCache();

  const director = await prisma.platformUser.findFirst({ where: { role: 'DIRECTOR' }, select: { id: true, name: true, role: true } });
  if (!director) { console.log('  ABORT: no Director in this database'); return; }
  const sites = await prisma.jobSite.findMany({ select: { id: true } });
  const viewer = { id: director.id, name: director.name, role: director.role,
                   siteIds: sites.map((s) => s.id) } as never;

  console.log('[1] Close it');
  const closed = await closeProject(viewer, site.id, { reason: 'roundtrip test', acknowledgedWarnings: true });
  chk('closeProject succeeded', closed.ok === true, closed.ok ? '' : `reason=${(closed as { reason: string }).reason}`);
  invalidateClosedProjectCache();
  const afterClose = await prisma.jobSite.findUnique({ where: { id: site.id }, select: { status: true, completedAt: true } });
  chk('the project is COMPLETED', afterClose?.status === 'COMPLETED', afterClose?.status);
  chk('completedAt was stamped', Boolean(afterClose?.completedAt));
  const asgAfterClose = await prisma.workerSiteAssignment.findUnique({ where: { id: asg.id }, select: { status: true } });
  chk('the operative assignment was SUSPENDED', asgAfterClose?.status === 'SUSPENDED', asgAfterClose?.status);

  console.log('\n[2] It is genuinely read-only now');
  let blocked = false;
  try { await prisma.jobSite.update({ where: { id: site.id }, data: { fireAssemblyPoint: 'x' } }); }
  catch { blocked = true; }
  chk('an ordinary site edit is refused', blocked);

  console.log('\n[3] Reopen it');
  const re = await reopenProject(viewer, site.id, { reason: 'roundtrip test', restoreAssignments: true });
  chk('reopenProject succeeded', re.ok === true, re.ok ? '' : `reason=${(re as { reason: string }).reason}`);
  invalidateClosedProjectCache();
  const afterReopen = await prisma.jobSite.findUnique({ where: { id: site.id }, select: { status: true, completedAt: true } });
  chk('the project is ACTIVE again', afterReopen?.status === 'ACTIVE', afterReopen?.status);
  chk('completedAt was cleared', afterReopen?.completedAt === null);
  const asgAfterReopen = await prisma.workerSiteAssignment.findUnique({ where: { id: asg.id }, select: { status: true } });
  chk('the operative assignment was restored to ACTIVE', asgAfterReopen?.status === 'ACTIVE', asgAfterReopen?.status);

  console.log('\n[4] Writes work again');
  let ok2 = false;
  try { await prisma.jobSite.update({ where: { id: site.id }, data: { fireAssemblyPoint: 'Car park' } }); ok2 = true; }
  catch { ok2 = false; }
  chk('an ordinary site edit is accepted', ok2);

  const events = await prisma.siteClosureEvent.findMany({ where: { jobSiteId: site.id }, select: { action: true } });
  chk('both closure events were recorded', events.length === 2,
      events.map((e) => e.action).join(' -> '));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await runProjectLifecycleWrite(async () => {
    for (const id of made.sites) {
      await prisma.siteClosureEvent.deleteMany({ where: { jobSiteId: id } });
      await prisma.workerAssignmentEvent.deleteMany({ where: { jobSiteId: id } });
      await prisma.workerSiteAssignment.deleteMany({ where: { jobSiteId: id } });
      await prisma.complianceSchedule.deleteMany({ where: { jobSiteId: id } });
      await prisma.jobSite.deleteMany({ where: { id } });
    }
    for (const id of made.workers) await prisma.worker.deleteMany({ where: { id } });
  });
  invalidateClosedProjectCache();
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
