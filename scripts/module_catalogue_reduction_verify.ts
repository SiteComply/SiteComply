export {};
/**
 * THE STANDARD MODULE SET IS THREE, AND THE OTHERS ARE COVERED ELSEWHERE.
 *
 * ── THE DECISION ──────────────────────────────────────────────────────────
 *
 * Site Setup collects the site-specific induction inputs, and the rules engine
 * generates scenes from them. Seven company-wide modules on top of that was about
 * three minutes of identical content before an operative heard anything about the
 * site they were standing on - and most of it was already said by a generated scene
 * or a default site rule.
 *
 * Standard set: Company introduction, Behavioural standards, Accident and near-miss
 * reporting. Manual handling moves to an OPTIONAL tier (training, not induction).
 * PPE expectations, Housekeeping and Environmental awareness are retired.
 *
 * ── WHAT THIS SUITE IS REALLY FOR ─────────────────────────────────────────
 *
 * Anybody can delete three array entries. The valuable part is proving the subjects
 * are still covered, so that re-adding one is a decision somebody argues for rather
 * than a gap somebody "fixes". Each retirement below is checked against the thing
 * that covers it.
 *
 * Run: npx tsx scripts/module_catalogue_reduction_verify.ts
 */
const { prisma } = require('../lib/prisma');
const cat = require('../services/inductionModules/moduleCatalogue');
const svc = require('../services/inductionModules/inductionModuleService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const director = moduleActorFromPlatformViewer(
  { id: 'mcr', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'mcr2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);

const slugs = (list: { slug: string }[]) => list.map((c) => c.slug);
const made: string[] = [];

(async () => {
  try {
    console.log('\nTHE STANDARD SET IS THREE');
    chk('exactly three standard modules', cat.MODULE_CATALOGUE.length === 3,
      slugs(cat.MODULE_CATALOGUE).join(', '));
    chk('  and they are the universal ones',
      JSON.stringify(slugs(cat.MODULE_CATALOGUE).sort()) ===
        JSON.stringify(['ACCIDENT_REPORTING', 'BEHAVIOURAL_STANDARDS', 'COMPANY_INTRODUCTION']),
      slugs(cat.MODULE_CATALOGUE).join(', '));
    for (const gone of ['PPE_EXPECTATIONS', 'HOUSEKEEPING', 'ENVIRONMENTAL_AWARENESS']) {
      chk(`  ${gone} is NOT in the standard set`,
        !slugs(cat.MODULE_CATALOGUE).includes(gone));
    }
    chk('the retirement is recorded, with what covers each subject',
      JSON.stringify([...cat.RETIRED_STANDARD_SLUGS].sort()) ===
        JSON.stringify(['ENVIRONMENTAL_AWARENESS', 'HOUSEKEEPING', 'PPE_EXPECTATIONS']),
      // Written down so a future reader finds the reasoning, not just the absence.
      [...cat.RETIRED_STANDARD_SLUGS].join(', '));

    console.log('\nTHE ONE GENUINELY UNIVERSAL MODULE IS ON BY DEFAULT');
    const intro = cat.MODULE_CATALOGUE.find((c: { slug: string }) => c.slug === 'COMPANY_INTRODUCTION');
    chk('company introduction is mandatory', intro.mandatory === true,
      'it is the only module no site equivalent can replace');
    chk('  and included by default', intro.defaultIncluded === true,
      'it was the ONE universal module switched off, which was backwards');
    chk('  and its wording still refuses to be issued unread',
      /REPLACE THIS TEXT BEFORE ISSUING/.test(intro.narration),
      'defaulting it on is only safe because a draft reaches nobody');

    console.log('\nMANUAL HANDLING IS AVAILABLE, NOT STANDARD');
    chk('it is in the optional tier',
      slugs(cat.OPTIONAL_MODULE_CATALOGUE).includes('MANUAL_HANDLING'),
      slugs(cat.OPTIONAL_MODULE_CATALOGUE).join(', '));
    const manual = cat.OPTIONAL_MODULE_CATALOGUE.find(
      (c: { slug: string }) => c.slug === 'MANUAL_HANDLING');
    chk('  off by default, so opting in is deliberate', manual.defaultIncluded === false);
    chk('  and not mandatory', manual.mandatory === false);
    chk('the combined list can still resolve it',
      slugs(cat.ALL_CATALOGUE_MODULES).includes('MANUAL_HANDLING') &&
        cat.ALL_CATALOGUE_MODULES.length === 4);
    chk('THE MISSING-MODULE PROMPT IGNORES THE OPTIONAL TIER',
      /MODULE_CATALOGUE\.filter/.test(code('components/inductionModules/ModulesIndex.tsx')) &&
        !/OPTIONAL_MODULE_CATALOGUE\.filter\(\s*\(c\) => !modules[\s\S]{0,40}missing/
          .test(code('components/inductionModules/ModulesIndex.tsx')),
      'a company that declines manual handling must not be nagged about it forever');

    console.log('\nPPE: THE SITE VERSION IS GUARANTEED, SO A COMPANY ONE COULD ONLY DUPLICATE IT');
    const setup = code('services/sites/siteSetupCompletion.ts');
    chk("site PPE GATES video generation",
      /of: 'ppeItems'[\s\S]{0,80}gates: 'VIDEO'/.test(setup),
      // This is the whole argument: no PPE, no video. So every video has a PPE scene.
      'siteSetupCompletion: "At least one PPE requirement", gates VIDEO');
    const rules = code('services/inductionVideo/sceneRules.ts');
    chk('  and the rules engine emits a REQUIRED PPE scene from the site list',
      /sceneType: 'PPE',[\s\S]{0,120}required: true/.test(rules));
    chk('  so no company module claims that subject',
      !slugs(cat.ALL_CATALOGUE_MODULES).includes('PPE_EXPECTATIONS'));
    chk('  and the default site rules say it as well',
      /Wear the PPE required for this site/.test(read('services/checklists/ukSiteRulesLibrary.ts')));

    console.log('\nHOUSEKEEPING: TWO DEFAULT SITE RULES SAY IT ALMOST VERBATIM');
    const ruleLib = read('services/checklists/ukSiteRulesLibrary.ts');
    chk('"keep walkways and fire exits clear" is a default rule',
      /Keep walkways, access routes and fire exits clear/.test(ruleLib));
    chk('"keep your work area clean and tidy" is a default rule',
      /Keep your work area clean and tidy/.test(ruleLib));
    chk('  and every site is seeded with the DEFAULT tier',
      /UK_SITE_RULES_DEFAULT/.test(code('services/checklists/ukInductionTemplate.ts')),
      'so this is not optional coverage - it is on every site');
    chk('  so no company module claims that subject',
      !slugs(cat.ALL_CATALOGUE_MODULES).includes('HOUSEKEEPING'));

    console.log('\nENVIRONMENTAL: THE SITE HAS ITS OWN SCENE, AND CONTROLS VARY BY SITE');
    chk('the rules engine can emit an ENVIRONMENTAL scene',
      /optional\('ENVIRONMENTAL'/.test(rules));
    chk('  and waste segregation is an optional site rule',
      /Segregate waste and use the correct skip/.test(ruleLib));
    chk('  so no company module claims that subject',
      !slugs(cat.ALL_CATALOGUE_MODULES).includes('ENVIRONMENTAL_AWARENESS'));

    console.log('\nACCIDENT REPORTING STAYS, BECAUSE IT YIELDS TO THE SITE');
    const accident = cat.MODULE_CATALOGUE.find(
      (c: { slug: string }) => c.slug === 'ACCIDENT_REPORTING');
    chk('it declares what it steps aside for',
      accident.replacesSceneType === 'INCIDENT_REPORTING',
      // Kept mandatory BECAUSE it cannot duplicate: a site documenting its own
      // procedure suppresses it automatically.
      'the overlap mechanism working as intended');
    chk('  and that scene really is generated from site data',
      /optional\('INCIDENT_REPORTING'/.test(rules));
    chk('  so it is safe to keep mandatory', accident.mandatory === true);

    console.log('\nTHE INDUCTION IS SHORTER, MEASURED');
    const words = (t: string) => (t.match(/[A-Za-z0-9’'-]+/g) ?? []).length;
    const standardWords = cat.MODULE_CATALOGUE.reduce(
      (n: number, c: { narration: string }) => n + words(c.narration), 0);
    // Measured from production: the Company Introduction narration, 104 words, was
    // rendered by the real voice in 28.064s — 3.7 words a second.
    const secs = Math.round(standardWords / 3.705);
    chk(`the company band is ~${secs}s of narration, not ~179s`, secs < 100,
      `${standardWords} words across ${cat.MODULE_CATALOGUE.length} modules`);

    console.log('\nA MODULE OUTSIDE THE STANDARD SET CAN STILL BE CREATED');
    chk('a Site Manager may not add one',
      (await svc.addCatalogueModule(manager, 'MANUAL_HANDLING')).ok === false,
      'company content is a Director’s decision');
    const bogus = await svc.addCatalogueModule(director, 'NOT_A_REAL_MODULE');
    chk('an invented slug is refused',
      bogus.ok === false && /not a module this platform can create/i.test(bogus.error),
      // A module with invented wording is what the catalogue exists to prevent.
      bogus.error ?? '');

    await prisma.inductionModule.deleteMany({ where: { slug: 'MANUAL_HANDLING' } });
    const added = await svc.addCatalogueModule(director, 'MANUAL_HANDLING');
    chk('a Director can add the optional module', added.ok === true, added.error ?? '');
    if (added.ok) {
      made.push(added.value.moduleId);
      chk('  it was created', added.value.created === true);
      const row = await prisma.inductionModule.findUnique({
        where: { id: added.value.moduleId },
        include: { revisions: true },
      });
      chk('  as a DRAFT, so it reaches nobody until read',
        row.revisions.length === 1 && row.revisions[0].status === 'DRAFT');
      chk('  and off by default', row.defaultIncluded === false);

      // Retiring then re-adding must bring the row BACK, not start a second history.
      await prisma.inductionModule.update({
        where: { id: added.value.moduleId }, data: { active: false },
      });
      const again = await svc.addCatalogueModule(director, 'MANUAL_HANDLING');
      chk('adding a RETIRED module brings it back rather than duplicating it',
        again.ok === true && again.value.created === false &&
          again.value.moduleId === added.value.moduleId,
        'its own history survives, including wording somebody has edited');
      const back = await prisma.inductionModule.findUnique({
        where: { id: added.value.moduleId }, select: { active: true },
      });
      chk('  and it is active again', back.active === true);
    }
  } finally {
    await prisma.inductionModule.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
