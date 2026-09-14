/**
 * Owner Review Item 15 — PPE requirements, managed from the Platform portal.
 *
 * This is a new VIEW onto existing data, so the assertions that matter are the
 * ones about what must NOT change: the other induction items, the versioning
 * rule, the operative's PPE screen, and the compliance signal.
 *
 * Run: npx tsx scripts/ppe_config_verify.ts
 */
import { prisma } from '../lib/prisma';
import {
  getSitePpeRequirements,
  saveSitePpeRequirements,
  DEFAULT_PPE,
} from '../services/checklists/sitePpeService';
import { getCurrentChecklist } from '../services/checklists/adminChecklistService';
import { buildInductionSteps, type FlowItem } from '../services/checklists/inductionFlow';
import { defaultInductionChecklistSeed } from '../services/sites/adminSiteService';

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};
const made = { sites: [] as string[], workers: [] as string[] };

const flow = (items: { id: string; label: string; helpText: string | null; type: string; required: boolean }[]) =>
  buildInductionSteps(items as FlowItem[]);

async function main() {
  console.log('== PPE REQUIREMENTS ==\n');
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const site = await prisma.jobSite.create({
    data: { name: 'PPE Test Site', addressLine1: '1 Way', town: 'T', postcode: 'TE1 1ST',
            jobReference: `PPE-${process.pid}`, createdByAdminId: admin!.id, status: 'ACTIVE',
            checklists: defaultInductionChecklistSeed() },
    select: { id: true } });
  made.sites.push(site.id);

  console.log('[1] It reads the PPE that already exists');
  const initial = await getSitePpeRequirements(site.id);
  chk('finds the seeded PPE', initial.length === 6, `${initial.length} items`);
  chk('names are right', initial[0]?.label === 'Hard hat', String(initial[0]?.label));
  chk('required/optional preserved',
      initial.filter((i) => i.required).length === 4 && initial.filter((i) => !i.required).length === 2,
      `${initial.filter((i) => i.required).length} required`);
  chk('the defaults offered match the UK template', DEFAULT_PPE.length === 6);

  const before = await getCurrentChecklist(site.id);
  const beforeOther = before!.items.filter((i) => i.type !== 'PPE_CONFIRM').map((i) => i.label);
  const beforeSteps = flow(before!.items);

  console.log('\n[2] Editing PPE leaves the rest of the induction alone');
  const edited = [
    ...initial.filter((i) => i.label !== 'Ear defenders'),
    { label: 'Cut-resistant gloves', helpText: null, required: true },
  ];
  const saved = await saveSitePpeRequirements(site.id, edited);
  chk('saved', saved.ok === true, saved.ok ? '' : (saved as { error: string }).error);
  const after = await getCurrentChecklist(site.id);
  const afterOther = after!.items.filter((i) => i.type !== 'PPE_CONFIRM').map((i) => i.label);
  chk('every non-PPE item is untouched, in the same order',
      JSON.stringify(afterOther) === JSON.stringify(beforeOther),
      `${afterOther.length} items`);
  const nowPpe = await getSitePpeRequirements(site.id);
  chk('the removed item is gone', !nowPpe.some((i) => i.label === 'Ear defenders'));
  chk('the added item is there', nowPpe.some((i) => i.label === 'Cut-resistant gloves'));
  chk('count is right', nowPpe.length === 6, `${nowPpe.length}`);

  console.log('\n[3] The induction still reads the same shape');
  const afterSteps = flow(after!.items);
  chk('the same number of screens as before',
      afterSteps.length === beforeSteps.length, `${beforeSteps.length} -> ${afterSteps.length}`);
  const ppeStep = afterSteps.find((s) => s.kind === 'ppe');
  chk('PPE is still ONE grouped screen', Boolean(ppeStep));
  chk('...carrying every PPE item', Boolean(ppeStep && ppeStep.kind === 'ppe' && ppeStep.items.length === 6),
      ppeStep && ppeStep.kind === 'ppe' ? `${ppeStep.items.length}` : 'n/a');
  chk('PPE did not move to the end',
      after!.items[after!.items.length - 1]!.type !== 'PPE_CONFIRM',
      `last item is ${after!.items[after!.items.length - 1]!.label}`);

  console.log('\n[4] Versioning — historic inductions must stay intact');
  const v1 = after!.version;
  const w = await prisma.worker.create({
    data: { mobile: `+4477004${String(process.pid).slice(-5).padStart(5,'0')}`, fullName: 'PPE Tester', company: 'T' } });
  made.workers.push(w.id);
  await prisma.submission.create({
    data: { workerId: w.id, jobSiteId: site.id, checklistVersion: v1, answers: {},
            status: 'COMPLIANT', gdprConsent: true, checkedInAt: new Date() } });
  const saved2 = await saveSitePpeRequirements(site.id, [
    ...nowPpe, { label: 'Face shield', helpText: null, required: false },
  ]);
  chk('a new version is published once someone has inducted',
      saved2.ok === true && saved2.newVersion === true,
      saved2.ok ? `v${saved2.version}` : (saved2 as { error: string }).error);
  const oldVersion = await prisma.complianceChecklist.findFirst({
    where: { jobSiteId: site.id, version: v1 }, include: { items: true } });
  chk('the version they answered still exists', Boolean(oldVersion));
  chk('...with its original PPE, unchanged',
      oldVersion!.items.filter((i) => i.type === 'PPE_CONFIRM').length === 6 &&
      !oldVersion!.items.some((i) => i.label === 'Face shield'),
      'a historic check-in must map to what was actually agreed');

  console.log('\n[5] It refuses what it should');
  const dup = await saveSitePpeRequirements(site.id, [
    { label: 'Hard hat', helpText: null, required: true },
    { label: 'hard HAT', helpText: null, required: true } ]);
  chk('duplicates rejected', dup.ok === false, dup.ok ? '' : (dup as { error: string }).error);
  const blank = await saveSitePpeRequirements(site.id, [{ label: ' ', helpText: null, required: true }]);
  chk('blank names rejected', blank.ok === false);
  const many = await saveSitePpeRequirements(site.id,
    Array.from({ length: 21 }, (_, i) => ({ label: `Item ${i}`, helpText: null, required: true })));
  chk('an absurd list rejected', many.ok === false);

  console.log('\n[6] Removing all PPE is allowed when other items remain');
  const none = await saveSitePpeRequirements(site.id, []);
  chk('PPE can be cleared', none.ok === true, none.ok ? '' : (none as { error: string }).error);
  const cleared = await getCurrentChecklist(site.id);
  chk('the acknowledgements survive', cleared!.items.length === beforeOther.length, `${cleared!.items.length}`);
  chk('no PPE screen in the induction', !flow(cleared!.items).some((s) => s.kind === 'ppe'));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const id of made.sites) {
    await prisma.submission.deleteMany({ where: { jobSiteId: id } });
    await prisma.checklistItem.deleteMany({ where: { checklist: { jobSiteId: id } } });
    await prisma.complianceChecklist.deleteMany({ where: { jobSiteId: id } });
    await prisma.jobSite.deleteMany({ where: { id } });
  }
  for (const id of made.workers) await prisma.worker.deleteMany({ where: { id } });
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
