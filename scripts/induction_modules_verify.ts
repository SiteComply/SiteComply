export {};
/**
 * Company induction modules, Phase A — the model and its management.
 *
 * THE PROPERTIES THAT MATTER:
 *  - a DRAFT never reaches a site, so seeding suggested wording is safe;
 *  - issuing is a Director's alone, and supersedes in one transaction so two
 *    revisions can never both be in force;
 *  - an issued revision is never edited — it is superseded, because "what was
 *    this operative told in July?" has to stay answerable;
 *  - the resolution rule lives in one place: site row, else default, else out;
 *  - a mandatory module cannot be excluded or retired.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/induction_modules_verify.ts
 */
const { prisma } = require('../lib/prisma');
const svc = require('../services/inductionModules/inductionModuleService');
const { MODULE_CATALOGUE } = require('../services/inductionModules/moduleCatalogue');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const director = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] as string[] };
const manager = { id: 'u2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] as string[] };
const engineer = { id: 'u3', name: 'Eve Engineer', role: 'ENGINEER', siteIds: [] as string[] };

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
  const slugs = MODULE_CATALOGUE.map((m: { slug: string }) => m.slug);
  // A clean slate: this suite owns the catalogue slugs on the local database.
  await prisma.inductionModule.deleteMany({ where: { slug: { in: slugs } } });

  try {
    console.log('\n[1] The starter set arrives as drafts, and reaches nobody');
    const seeded = await svc.seedModuleCatalogue('Test');
    chk('the six standard modules are created', seeded.created === 6, JSON.stringify(seeded));
    chk('  seeding twice adds nothing', (await svc.seedModuleCatalogue('Test')).created === 0);
    const listed = await svc.listModules();
    const ours = listed.filter((m: { slug: string }) => slugs.includes(m.slug));
    chk('  every one is a DRAFT, not issued',
      ours.every((m: { issued: unknown; draft: unknown }) => m.issued === null && m.draft !== null));
    chk('  so a site resolves NONE of them',
      (await svc.resolveModulesForSite(site.id)).length === 0);
    chk('the mandatory three are the ones the owner chose',
      ours.filter((m: { mandatory: boolean }) => m.mandatory).map((m: { slug: string }) => m.slug).sort().join(',') ===
        'ACCIDENT_REPORTING,BEHAVIOURAL_STANDARDS,PPE_EXPECTATIONS',
      ours.filter((m: { mandatory: boolean }) => m.mandatory).map((m: { slug: string }) => m.slug).join(','));
    chk('  and the other three are optional but on by default',
      ours.filter((m: { mandatory: boolean }) => !m.mandatory)
        .every((m: { defaultIncluded: boolean }) => m.defaultIncluded));
    chk('accident reporting yields to a project\'s own arrangement',
      ours.find((m: { slug: string }) => m.slug === 'ACCIDENT_REPORTING')?.replacesSceneType === 'INCIDENT_REPORTING');

    console.log('\n[2] Issuing is a Director\'s, and only a draft can be issued');
    const ppe = ours.find((m: { slug: string }) => m.slug === 'PPE_EXPECTATIONS')!;
    const draftId = ppe.draft!.id;
    chk('an Engineer may not draft', (await svc.startDraft(engineer, ppe.id)).ok === false);
    chk('a Site Manager may draft', (await svc.startDraft(manager, ppe.id)).ok === true);
    chk('  and drafting twice returns the SAME draft, not a second one',
      (await svc.startDraft(manager, ppe.id)).value.revisionId === draftId);
    const smIssue = await svc.issueRevision(manager, draftId, 'Trying to issue');
    chk('a Site Manager may NOT issue', smIssue.ok === false, smIssue.ok ? '' : smIssue.error);
    const noNote = await svc.issueRevision(director, draftId, '');
    chk('issuing demands a note saying what changed', noNote.ok === false, noNote.ok ? '' : noNote.error);
    const issued = await svc.issueRevision(director, draftId, 'Initial wording reviewed and adopted.');
    chk('a Director issues it', issued.ok === true, issued.ok ? '' : issued.error);
    chk('  and it cannot be issued twice',
      (await svc.issueRevision(director, draftId, 'again')).ok === false);

    console.log('\n[3] An issued revision is never edited');
    const edit = await svc.saveDraft(director, draftId, { heading: 'X', narration: 'y'.repeat(50) });
    chk('editing an issued revision is refused', edit.ok === false, edit.ok ? '' : edit.error);
    const second = await svc.startDraft(director, ppe.id);
    chk('a new draft starts at version 2', second.value.version === 2);
    const full = await svc.getModule(ppe.id);
    chk('  pre-filled from the words in force, not blank',
      full.revisions.find((r: { version: number }) => r.version === 2).narration ===
        full.revisions.find((r: { version: number }) => r.version === 1).narration);

    console.log('\n[4] One revision in force, ever');
    await svc.saveDraft(director, second.value.revisionId, {
      heading: 'What we expect of your PPE',
      narration: 'Wear it from the moment you enter the working area. '.repeat(2) + 'Tell your supervisor if anything is damaged.',
    });
    await svc.issueRevision(director, second.value.revisionId, 'Shortened after feedback.');
    const after = await svc.getModule(ppe.id);
    const inForce = after.revisions.filter((r: { status: string }) => r.status === 'ISSUED');
    chk('exactly one issued revision', inForce.length === 1 && inForce[0].version === 2,
      after.revisions.map((r: { version: number; status: string }) => `v${r.version}:${r.status}`).join(' '));
    chk('  and the one it replaced is kept, not deleted',
      after.revisions.some((r: { version: number; status: string }) => r.version === 1 && r.status === 'SUPERSEDED'));

    console.log('\n[5] What a site resolves');
    let resolved = await svc.resolveModulesForSite(site.id);
    chk('only the issued module reaches the site', resolved.length === 1 && resolved[0].slug === 'PPE_EXPECTATIONS',
      resolved.map((r: { slug: string }) => r.slug).join(','));
    chk('  carrying the CURRENT revision', resolved[0].version === 2);
    chk('  not overridden by default', resolved[0].overridden === false);

    // A site excludes an optional module, and tries to exclude a mandatory one.
    const housekeeping = ours.find((m: { slug: string }) => m.slug === 'HOUSEKEEPING')!;
    await prisma.inductionModuleRevision.updateMany({
      where: { moduleId: housekeeping.id, status: 'DRAFT' },
      data: { status: 'ISSUED', issuedAt: new Date(), issuedByName: 'Test' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('a second issued module joins it', resolved.length === 2);

    await prisma.siteInductionModule.create({
      data: { jobSiteId: site.id, moduleId: housekeeping.id, state: 'EXCLUDED', reason: 'Covered by the client induction.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('an optional module can be excluded by a site',
      !resolved.some((r: { slug: string }) => r.slug === 'HOUSEKEEPING'));

    await prisma.siteInductionModule.create({
      data: { jobSiteId: site.id, moduleId: ppe.id, state: 'EXCLUDED', reason: 'Trying it on.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('a MANDATORY module cannot be excluded, whatever the site row says',
      resolved.some((r: { slug: string }) => r.slug === 'PPE_EXPECTATIONS'));

    await prisma.siteInductionModule.update({
      where: { jobSiteId_moduleId: { jobSiteId: site.id, moduleId: ppe.id } },
      data: { state: 'OVERRIDDEN', overrideNarration: 'On this site you must also wear cut-resistant gloves at all times.', reason: 'Client requirement.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    const overridden = resolved.find((r: { slug: string }) => r.slug === 'PPE_EXPECTATIONS');
    chk('an override replaces the words', /cut-resistant/.test(overridden.narration));
    chk('  and is flagged as a departure, with its reason',
      overridden.overridden === true && overridden.overrideReason === 'Client requirement.');

    console.log('\n[6] Retiring, not deleting');
    const retireMandatory = await svc.setModuleActive(director, ppe.id, false);
    chk('a mandatory module cannot be retired while it is mandatory',
      retireMandatory.ok === false, retireMandatory.ok ? '' : retireMandatory.error);
    chk('an optional one can be', (await svc.setModuleActive(director, housekeeping.id, false)).ok === true);
    chk('  and then reaches nobody',
      !(await svc.resolveModulesForSite(site.id)).some((r: { slug: string }) => r.slug === 'HOUSEKEEPING'));
    chk('  but its revisions are still there', (await svc.getModule(housekeeping.id)).revisions.length >= 1);

    console.log('\n[7] The design decisions are written down');
    const service = read('services/inductionModules/inductionModuleService.ts');
    chk('the resolution rule lives in ONE place',
      (service.match(/export async function resolveModulesForSite/g) ?? []).length === 1);
    chk('the service says why these are versioned and arrangements are not',
      /freeze|frozen|spoken to every operative|SPOKEN TO EVERY OPERATIVE/i.test(service));
    const catalogue = read('services/inductionModules/moduleCatalogue.ts');
    chk('the starter wording says it is a starting point, not policy',
      /STARTING POINT|starting point/i.test(catalogue));
    chk('every catalogue module has narration long enough to be a briefing',
      MODULE_CATALOGUE.every((m: { narration: string }) => m.narration.length > 200));
    chk('  and short enough for one spoken scene',
      MODULE_CATALOGUE.every((m: { narration: string }) => m.narration.length <= 3000));
  } catch (e: any) {
    console.log(`  ERROR ${e.message}`);
    fails++;
  } finally {
    await prisma.inductionModule.deleteMany({ where: { slug: { in: slugs } } });
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
