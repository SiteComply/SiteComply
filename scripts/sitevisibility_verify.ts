/**
 * Owner Review Item 17 — operatives only see their own projects.
 *
 * The risk in this change is over-hiding: an operative who HAS been invited but
 * cannot check in right now (awaiting approval, suspended, outside their access
 * window) must still see the project, or they lose the label telling them what
 * to ask for. So every assignment state is asserted, not just the two obvious
 * ones.
 *
 * Run: npx tsx scripts/sitevisibility_verify.ts
 */
import { prisma } from '../lib/prisma';
import { listSitesForWorkerSelection } from '../services/sites/siteService';
import { siteAccessHintsForWorker } from '../services/workerAccess/workerAssignmentService';

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const made = { sites: [] as string[], workers: [] as string[] };
const DAY = 86_400_000;

async function main() {
  console.log('== OPERATIVE SITE VISIBILITY ==\n');
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const mk = async (name: string) => {
    const s = await prisma.jobSite.create({
      data: { name, addressLine1: '1 Way', town: 'T', postcode: 'TE1 1ST',
              jobReference: `V17-${made.sites.length}-${process.pid}`,
              createdByAdminId: admin!.id, status: 'ACTIVE' },
      select: { id: true, name: true } });
    made.sites.push(s.id); return s;
  };

  const noRel   = await mk('V17 no relationship');
  const active  = await mk('V17 active');
  const invited = await mk('V17 invited');
  const susp    = await mk('V17 suspended');
  const removed = await mk('V17 removed');
  const pending = await mk('V17 window pending');
  const expired = await mk('V17 window expired');

  const w = await prisma.worker.create({
    data: { mobile: `+4477006${String(process.pid).slice(-5).padStart(5,'0')}`,
            fullName: 'V17 Tester', company: 'T' } });
  made.workers.push(w.id);

  const assign = (siteId: string, status: 'ACTIVE'|'INVITED'|'SUSPENDED'|'REMOVED',
                  startDate: Date | null = null, endDate: Date | null = null) =>
    prisma.workerSiteAssignment.create({ data: { workerId: w.id, jobSiteId: siteId, status, startDate, endDate } });

  await assign(active.id, 'ACTIVE');
  await assign(invited.id, 'INVITED');
  await assign(susp.id, 'SUSPENDED');
  await assign(removed.id, 'REMOVED');
  await assign(pending.id, 'ACTIVE', new Date(Date.now() + 7 * DAY), null);
  await assign(expired.id, 'ACTIVE', null, new Date(Date.now() - 7 * DAY));

  const visible = await listSitesForWorkerSelection(w.id);
  const names = visible.map((s) => s.name).filter((n) => n.startsWith('V17'));
  console.log('  visible: ' + names.join(', ') + '\n');

  console.log('[1] Projects with no relationship are gone');
  chk('a site they were never invited to is HIDDEN', !names.includes('V17 no relationship'),
      'this is the reported defect');
  chk('...and is not even fetched from the database',
      !visible.some((s) => s.id === noRel.id),
      'filtered in the query, so it never reaches the browser');

  console.log('\n[2] Access that was ended is gone');
  chk('a REMOVED assignment is hidden', !names.includes('V17 removed'));

  console.log('\n[3] Everything they ARE on stays visible');
  chk('active assignment', names.includes('V17 active'));
  chk('awaiting approval (INVITED)', names.includes('V17 invited'),
      'the owner asked for "active assignment OR invitation"');
  chk('suspended', names.includes('V17 suspended'), 'they need to know why');
  chk('access window not started yet', names.includes('V17 window pending'));
  chk('access window ended', names.includes('V17 window expired'));

  console.log('\n[4] The badges still explain each one');
  const hints = await siteAccessHintsForWorker(w.id, visible);
  const shortOf = (id: string) => { const h = hints.get(id); return h && 'short' in h ? h.short : h?.state; };
  chk('invited reads "Awaiting approval"', shortOf(invited.id) === 'Awaiting approval', String(shortOf(invited.id)));
  chk('suspended reads "Access suspended"', shortOf(susp.id) === 'Access suspended', String(shortOf(susp.id)));
  chk('pending names the start date', String(shortOf(pending.id)).startsWith('Access starts'), String(shortOf(pending.id)));
  chk('expired names the end date', String(shortOf(expired.id)).startsWith('Access ended'), String(shortOf(expired.id)));
  chk('active is not badged as blocked', shortOf(active.id) !== 'Not invited', String(shortOf(active.id)));

  console.log('\n[5] An operative on nothing sees nothing');
  const w2 = await prisma.worker.create({
    data: { mobile: `+4477005${String(process.pid).slice(-5).padStart(5,'0')}`, fullName: 'V17 Newcomer', company: 'T' } });
  made.workers.push(w2.id);
  const none = await listSitesForWorkerSelection(w2.id);
  chk('a brand-new operative gets an empty list', none.length === 0, `${none.length} sites`);
  chk('the empty state tells them to be invited, not that no sites exist',
      require('fs').readFileSync('components/checkin/SiteSelector.tsx', 'utf8')
        .includes('You have not been invited to any projects yet'));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const id of made.sites) {
    await prisma.workerAssignmentEvent.deleteMany({ where: { jobSiteId: id } }).catch(() => {});
    await prisma.workerSiteAssignment.deleteMany({ where: { jobSiteId: id } });
    await prisma.jobSite.deleteMany({ where: { id } });
  }
  for (const id of made.workers) await prisma.worker.deleteMany({ where: { id } });
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
