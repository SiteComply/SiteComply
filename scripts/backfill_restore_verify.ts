/**
 * Proves the INVITED → ACTIVE restoration only touches what it should.
 *
 * This script GRANTS SITE ACCESS, so the cases that must be left alone matter
 * more than the case that must be fixed. Each is set up for real in the local
 * database, the backfill is run, and the outcome asserted.
 *
 * Run: npx tsx scripts/backfill_restore_verify.ts
 */
import { WorkerAssignmentStatus } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { prisma } from '../lib/prisma';

const CUTOVER = '2026-09-10T05:19:48Z';
let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const made: { workers: string[]; site?: string } = { workers: [] };

async function makeWorker(name: string, mobile: string) {
  const w = await prisma.worker.create({ data: { mobile, fullName: name, company: 'Restore Test' } });
  made.workers.push(w.id);
  return w;
}

async function checkIn(workerId: string, siteId: string, when: string) {
  await prisma.submission.create({
    data: {
      workerId, jobSiteId: siteId, checklistVersion: 1, answers: {},
      status: 'COMPLIANT', gdprConsent: true, checkedInAt: new Date(when),
    },
  });
}

async function main() {
  console.log('== RESTORE BACKFILL — SAFETY ==\n');
  const site = await prisma.jobSite.findFirst({ select: { id: true, name: true } });
  if (!site) { console.log('  ABORT: need a site'); process.exit(1); }
  made.site = site.id;
  console.log(`  site: ${site.name}\n`);

  const before = new Date('2026-09-01T08:00:00Z');
  const after = new Date('2026-09-10T09:00:00Z');

  // A — the regression: INVITED, used the site, invited before the cutover.
  const a = await makeWorker('Restore Legacy', '+447700900801');
  await prisma.workerSiteAssignment.create({
    data: { workerId: a.id, jobSiteId: site.id, status: WorkerAssignmentStatus.INVITED, invitedAt: before },
  });
  await checkIn(a.id, site.id, '2026-09-02T08:00:00Z');

  // B — invited AFTER the cutover: a deliberate exception.
  const b = await makeWorker('Restore Recent', '+447700900802');
  await prisma.workerSiteAssignment.create({
    data: { workerId: b.id, jobSiteId: site.id, status: WorkerAssignmentStatus.INVITED, invitedAt: after },
  });
  await checkIn(b.id, site.id, '2026-09-02T08:00:00Z');

  // C — transferred in: the receiving site must approve.
  const c = await makeWorker('Restore Transfer', '+447700900803');
  await prisma.workerSiteAssignment.create({
    data: {
      workerId: c.id, jobSiteId: site.id, status: WorkerAssignmentStatus.INVITED,
      invitedAt: before, transferredFromSiteName: 'Another Project',
    },
  });
  await checkIn(c.id, site.id, '2026-09-02T08:00:00Z');

  // D — was SUSPENDED at some point: never quietly restore.
  const d = await makeWorker('Restore Suspended', '+447700900804');
  await prisma.workerSiteAssignment.create({
    data: { workerId: d.id, jobSiteId: site.id, status: WorkerAssignmentStatus.INVITED, invitedAt: before },
  });
  await checkIn(d.id, site.id, '2026-09-02T08:00:00Z');
  await prisma.workerAssignmentEvent.create({
    data: {
      workerId: d.id, workerName: d.fullName, jobSiteId: site.id, siteName: site.name,
      action: 'SUSPENDED', actorName: 'Test', detail: 'Suspended in the test fixture.',
    },
  });

  // E — INVITED but never checked in: nothing was lost.
  const e = await makeWorker('Restore NoHistory', '+447700900805');
  await prisma.workerSiteAssignment.create({
    data: { workerId: e.id, jobSiteId: site.id, status: WorkerAssignmentStatus.INVITED, invitedAt: before },
  });

  // F — an untouched SUSPENDED assignment, to prove the pass ignores it entirely.
  const f = await makeWorker('Restore StillSuspended', '+447700900806');
  await prisma.workerSiteAssignment.create({
    data: {
      workerId: f.id, jobSiteId: site.id, status: WorkerAssignmentStatus.SUSPENDED,
      invitedAt: before, suspendedAt: new Date(), suspendedByName: 'Test',
    },
  });
  await checkIn(f.id, site.id, '2026-09-02T08:00:00Z');

  console.log('[1] Dry run reports the right candidate and nothing else');
  const dry = execFileSync('npx', ['tsx', 'scripts/backfill_assignments_from_checkins.ts'],
    { encoding: 'utf8', env: { ...process.env, CUTOVER } });
  chk('the legacy row is a candidate', /Restore Legacy/.test(dry));
  chk('the post-cutover row is not', !/Restore Recent — first checked/.test(dry));
  chk('a dry run writes nothing',
      (await prisma.workerSiteAssignment.findFirst({ where: { workerId: a.id } }))!.status === WorkerAssignmentStatus.INVITED);

  console.log('\n[2] Applying');
  execFileSync('npx', ['tsx', 'scripts/backfill_assignments_from_checkins.ts', '--apply'],
    { encoding: 'utf8', env: { ...process.env, CUTOVER } });

  const st = async (id: string) =>
    (await prisma.workerSiteAssignment.findFirst({ where: { workerId: id, jobSiteId: site.id } }))!.status;

  chk('A: the regression is restored to ACTIVE', (await st(a.id)) === WorkerAssignmentStatus.ACTIVE);
  chk('B: invited after the cutover stays INVITED', (await st(b.id)) === WorkerAssignmentStatus.INVITED);
  chk('C: a transfer-in stays INVITED', (await st(c.id)) === WorkerAssignmentStatus.INVITED);
  chk('D: a previously suspended worker stays INVITED', (await st(d.id)) === WorkerAssignmentStatus.INVITED);
  chk('E: no check-in history stays INVITED', (await st(e.id)) === WorkerAssignmentStatus.INVITED);
  chk('F: a SUSPENDED assignment is untouched', (await st(f.id)) === WorkerAssignmentStatus.SUSPENDED);

  console.log('\n[3] The restoration is auditable and idempotent');
  const ev = await prisma.workerAssignmentEvent.findFirst({
    where: { workerId: a.id, jobSiteId: site.id, action: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
  });
  chk('an APPROVED event records why', /already checked in/i.test(ev?.detail ?? ''), ev?.detail?.slice(0, 70));
  chk('it is attributed to the backfill, not a person', ev?.actorName === 'Backfill', ev?.actorName);

  const second = execFileSync('npx', ['tsx', 'scripts/backfill_assignments_from_checkins.ts', '--apply'],
    { encoding: 'utf8', env: { ...process.env, CUTOVER } });
  chk('a second run promotes nothing', /INVITED rows to promote: *0/.test(second.replace(/\s+/g, ' ')),
      (second.match(/INVITED rows to promote: *\d+/) ?? [''])[0]);

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const id of made.workers) {
    await prisma.workerAssignmentEvent.deleteMany({ where: { workerId: id } });
    await prisma.submission.deleteMany({ where: { workerId: id } });
    await prisma.workerSiteAssignment.deleteMany({ where: { workerId: id } });
    await prisma.worker.deleteMany({ where: { id } });
  }
  console.log(`   cleaned up ${made.workers.length} fixtures`);
  await prisma.$disconnect();
});
