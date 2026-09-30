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
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const {
  MODULE_CATALOGUE,
  OPTIONAL_MODULE_CATALOGUE,
  ALL_CATALOGUE_MODULES,
} = require('../services/inductionModules/moduleCatalogue');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const directorViewer = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] as string[] };
const managerViewer = { id: 'u2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] as string[] };
const engineerViewer = { id: 'u3', name: 'Eve Engineer', role: 'ENGINEER', siteIds: [] as string[] };
/*
 * The service takes a decided capability, not a viewer: company modules are
 * administered from two realms, so authority is resolved by an adapter at the
 * edge. These suites go through the SAME adapter the Platform routes use -
 * hand-building a ModuleActor here would test a fiction.
 */
const director = moduleActorFromPlatformViewer(directorViewer as never);
const manager = moduleActorFromPlatformViewer(managerViewer as never);
const engineer = moduleActorFromPlatformViewer(engineerViewer as never);

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
  /*
   * BOTH TIERS. The standard set is seeded; the optional tier is created on request.
   * The teardown has to own both, or a MANUAL_HANDLING row survives the run and the
   * next one finds it already there.
   */
  const slugs = ALL_CATALOGUE_MODULES.map((m: { slug: string }) => m.slug);
  // A clean slate: this suite owns the catalogue slugs on the local database.
  await prisma.inductionModule.deleteMany({ where: { slug: { in: slugs } } });

  try {
    console.log('\n[1] The starter set arrives as drafts, and reaches nobody');
    const seeded = await svc.seedModuleCatalogue({ name: 'Test', realm: 'PLATFORM' });
    /*
     * COUNTED FROM THE CATALOGUE, not written as a number. This assertion said "six"
     * and silently went stale when the owner reduced the standard set to three - and
     * because this suite was not in the deploy gate, nothing noticed for a day.
     */
    chk(`the ${MODULE_CATALOGUE.length} standard modules are created`,
      seeded.created === MODULE_CATALOGUE.length, JSON.stringify(seeded));
    chk('  seeding twice adds nothing', (await svc.seedModuleCatalogue({ name: 'Test', realm: 'PLATFORM' })).created === 0);
    const listed = await svc.listModules();
    const ours = listed.filter((m: { slug: string }) => slugs.includes(m.slug));
    chk('  every one is a DRAFT, not issued',
      ours.every((m: { issued: unknown; draft: unknown }) => m.issued === null && m.draft !== null));
    chk('  so a site resolves NONE of them',
      (await svc.resolveModulesForSite(site.id)).length === 0);
    // Read from the catalogue too, so reducing or extending the standard set does not
    // leave a hard-coded list behind claiming to know what the owner chose.
    const expectMandatory = MODULE_CATALOGUE
      .filter((m: { mandatory: boolean }) => m.mandatory).map((m: { slug: string }) => m.slug).sort();
    chk('the mandatory ones are exactly the catalogue says',
      ours.filter((m: { mandatory: boolean }) => m.mandatory)
        .map((m: { slug: string }) => m.slug).sort().join(',') === expectMandatory.join(','),
      ours.filter((m: { mandatory: boolean }) => m.mandatory).map((m: { slug: string }) => m.slug).join(','));
    chk('  and every standard module is included by default',
      ours.every((m: { defaultIncluded: boolean }) => m.defaultIncluded));
    chk('the OPTIONAL tier is NOT seeded — it is training, not induction',
      OPTIONAL_MODULE_CATALOGUE.length > 0 &&
      !ours.some((m: { slug: string }) =>
        OPTIONAL_MODULE_CATALOGUE.some((o: { slug: string }) => o.slug === m.slug)),
      OPTIONAL_MODULE_CATALOGUE.map((o: { slug: string }) => o.slug).join(','));
    chk('accident reporting yields to a project\'s own arrangement',
      ours.find((m: { slug: string }) => m.slug === 'ACCIDENT_REPORTING')?.replacesSceneType === 'INCIDENT_REPORTING');

    console.log('\n[2] Issuing is a Director\'s, and only a draft can be issued');
    /*
     * `intro` plays the part PPE_EXPECTATIONS used to: a MANDATORY standard module,
     * used below for the draft/issue flow, the override and the retire refusal. PPE
     * was retired from the catalogue, so this suite crashed on `ppe.draft` - an
     * undefined-property error rather than a legible failure.
     */
    const intro = ours.find((m: { slug: string }) => m.slug === 'COMPANY_INTRODUCTION')!;
    chk('the subject under test is mandatory, as this section assumes',
      intro !== undefined && intro.mandatory === true);
    const draftId = intro.draft!.id;
    chk('an Engineer may not draft', (await svc.startDraft(engineer, intro.id)).ok === false);
    chk('a Site Manager may draft', (await svc.startDraft(manager, intro.id)).ok === true);
    chk('  and drafting twice returns the SAME draft, not a second one',
      (await svc.startDraft(manager, intro.id)).value.revisionId === draftId);
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
    const second = await svc.startDraft(director, intro.id);
    chk('a new draft starts at version 2', second.value.version === 2);
    const full = await svc.getModule(intro.id);
    chk('  pre-filled from the words in force, not blank',
      full.revisions.find((r: { version: number }) => r.version === 2).narration ===
        full.revisions.find((r: { version: number }) => r.version === 1).narration);

    console.log('\n[4] One revision in force, ever');
    await svc.saveDraft(director, second.value.revisionId, {
      heading: 'Who we are, and how we work',
      narration: 'This company has been building since 1998, and every site runs the same way. '.repeat(2)
        + 'Ask your supervisor if anything here is unclear.',
    });
    await svc.issueRevision(director, second.value.revisionId, 'Shortened after feedback.');
    const after = await svc.getModule(intro.id);
    const inForce = after.revisions.filter((r: { status: string }) => r.status === 'ISSUED');
    chk('exactly one issued revision', inForce.length === 1 && inForce[0].version === 2,
      after.revisions.map((r: { version: number; status: string }) => `v${r.version}:${r.status}`).join(' '));
    chk('  and the one it replaced is kept, not deleted',
      after.revisions.some((r: { version: number; status: string }) => r.version === 1 && r.status === 'SUPERSEDED'));

    console.log('\n[5] What a site resolves');
    let resolved = await svc.resolveModulesForSite(site.id);
    chk('only the issued module reaches the site', resolved.length === 1 && resolved[0].slug === 'COMPANY_INTRODUCTION',
      resolved.map((r: { slug: string }) => r.slug).join(','));
    chk('  carrying the CURRENT revision', resolved[0].version === 2);
    chk('  not overridden by default', resolved[0].overridden === false);

    // A site excludes an optional module, and tries to exclude a mandatory one.
    /*
     * AN OPTIONAL MODULE HAS TO BE FETCHED, NOT FOUND. Every module in the standard
     * catalogue is now mandatory, so the exclude and retire cases below - which need
     * a module a site is ALLOWED to leave out - use the optional tier. HOUSEKEEPING
     * used to play this part and was retired from the catalogue.
     */
    const added = await svc.addCatalogueModule(director, OPTIONAL_MODULE_CATALOGUE[0].slug);
    chk('an optional-tier module can be created on request', added.ok === true,
      added.ok ? OPTIONAL_MODULE_CATALOGUE[0].slug : added.error);
    const optional = await svc.getModule(added.value.moduleId);
    chk('  and it arrives OFF by default — training, not induction',
      optional.mandatory === false && optional.defaultIncluded === false);
    await prisma.inductionModuleRevision.updateMany({
      where: { moduleId: optional.id, status: 'DRAFT' },
      data: { status: 'ISSUED', issuedAt: new Date(), issuedByName: 'Test' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('  issued but off by default, it still reaches nobody',
      !resolved.some((r: { id: string }) => r.id === optional.id),
      'the inclusion rule is default-off, not issued-means-included');
    // Turned on for the company, it joins the induction - and can then be excluded.
    await svc.updateModuleSettings(director, optional.id, { defaultIncluded: true });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('a second issued module joins it once it is on by default', resolved.length === 2,
      resolved.map((r: { slug: string }) => r.slug).join(','));

    await prisma.siteInductionModule.create({
      data: { jobSiteId: site.id, moduleId: optional.id, state: 'EXCLUDED', reason: 'Covered by the client induction.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('an optional module can be excluded by a site',
      !resolved.some((r: { id: string }) => r.id === optional.id));

    await prisma.siteInductionModule.create({
      data: { jobSiteId: site.id, moduleId: intro.id, state: 'EXCLUDED', reason: 'Trying it on.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    chk('a MANDATORY module cannot be excluded, whatever the site row says',
      resolved.some((r: { slug: string }) => r.slug === 'COMPANY_INTRODUCTION'));

    await prisma.siteInductionModule.update({
      where: { jobSiteId_moduleId: { jobSiteId: site.id, moduleId: intro.id } },
      data: { state: 'OVERRIDDEN', overrideNarration: 'On this project we are working as a subcontractor to the principal contractor, who runs the site.', reason: 'Client requirement.' },
    });
    resolved = await svc.resolveModulesForSite(site.id);
    const overridden = resolved.find((r: { slug: string }) => r.slug === 'COMPANY_INTRODUCTION');
    chk('an override replaces the words', /principal contractor/.test(overridden.narration));
    chk('  and is flagged as a departure, with its reason',
      overridden.overridden === true && overridden.overrideReason === 'Client requirement.');

    console.log('\n[6] Retiring, not deleting');
    const retireMandatory = await svc.setModuleActive(director, intro.id, false);
    chk('a mandatory module cannot be retired while it is mandatory',
      retireMandatory.ok === false, retireMandatory.ok ? '' : retireMandatory.error);
    chk('an optional one can be', (await svc.setModuleActive(director, optional.id, false)).ok === true);
    chk('  and then reaches nobody',
      !(await svc.resolveModulesForSite(site.id)).some((r: { id: string }) => r.id === optional.id));
    chk('  but its revisions are still there', (await svc.getModule(optional.id)).revisions.length >= 1);

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
    /*
     * PUT THE CATALOGUE BACK. This suite needs a clean slate, so it owns and deletes
     * the catalogue slugs — which used to leave the local database with NO standard
     * modules once it finished. Harmless while nothing ran it; now that it is in the
     * deploy gate, every deploy emptied the local catalogue and the next person to
     * open the app locally found Company Modules blank.
     *
     * Re-seeding leaves the drafts the seed creates, which is the state a fresh
     * database is in anyway. Failures are swallowed: this is tidying up after a test
     * run, and it must never turn a green suite red.
     */
    try {
      await svc.seedModuleCatalogue(director);
    } catch {
      // Nothing to do: the suite's result stands either way.
    }
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
