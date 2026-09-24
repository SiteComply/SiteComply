export {};
/**
 * Company induction modules, Phase C — what one project decides.
 *
 * THE PROPERTIES THAT MATTER:
 *  - excluding and overriding both demand a reason, and record who decided;
 *  - an override is a DIRECTOR's; leaving a module out is not;
 *  - a mandatory module cannot be left out, whoever asks;
 *  - "back to the company standard" removes the decision rather than storing a
 *    third state meaning "no decision";
 *  - the screen and the generated script read the SAME resolver, so they cannot
 *    disagree about what an operative will hear.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/induction_modules_phasec_verify.ts
 */
const { prisma } = require('../lib/prisma');
const svc = require('../services/inductionModules/inductionModuleService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
/**
 * JSX wraps prose across lines, so a sentence a reader sees as one line is not
 * one line in the file. Asserting on the raw source fails on correct output.
 */
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

const directorViewer = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] as string[] };
const managerViewer = { id: 'u2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] as string[] };
/*
 * The service takes a decided capability, not a viewer: company modules are
 * administered from two realms, so authority is resolved by an adapter at the
 * edge. These suites go through the SAME adapter the Platform routes use -
 * hand-building a ModuleActor here would test a fiction.
 */
const director = moduleActorFromPlatformViewer(directorViewer as never);
const manager = moduleActorFromPlatformViewer(managerViewer as never);

const SLUGS = ['PHASEC_MANDATORY', 'PHASEC_OPTIONAL'];

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
  await prisma.inductionModule.deleteMany({ where: { slug: { in: SLUGS } } });

  try {
    // Two issued modules: one mandatory, one optional.
    const made: Record<string, string> = {};
    for (const [slug, mandatory] of [['PHASEC_MANDATORY', true], ['PHASEC_OPTIONAL', false]] as const) {
      const m = await prisma.inductionModule.create({
        data: { slug, title: slug === 'PHASEC_MANDATORY' ? 'Behavioural standards' : 'Manual handling',
          mandatory, defaultIncluded: true, order: mandatory ? 20 : 50 },
        select: { id: true },
      });
      await prisma.inductionModuleRevision.create({
        data: {
          moduleId: m.id, version: 1, status: 'ISSUED', issuedAt: new Date(), issuedByName: 'Dee Director',
          heading: 'Heading', preparedByName: 'Dee Director',
          narration: 'Treat everyone on site with respect, and stop anything you believe to be unsafe.',
          contentHash: 'h',
        },
      });
      made[slug] = m.id;
    }

    console.log('\n[1] By default, the company standard applies');
    let rows = await svc.moduleDecisionsForSite(site.id);
    const ours = rows.filter((r: { slug: string }) => SLUGS.includes(r.slug));
    chk('both modules are included with no decision recorded',
      ours.length === 2 && ours.every((r: { included: boolean; state: null }) => r.included && r.state === null));
    chk('  and the screen shows the company wording',
      ours.every((r: { companyNarration: string }) => /Treat everyone on site/.test(r.companyNarration)));

    console.log('\n[2] Leaving a module out');
    const noReason = await svc.setSiteModuleDecision(manager, site.id, made.PHASEC_OPTIONAL, { state: 'EXCLUDED', reason: 'no' });
    chk('excluding without a real reason is refused', noReason.ok === false, noReason.ok ? '' : noReason.error);
    const excluded = await svc.setSiteModuleDecision(manager, site.id, made.PHASEC_OPTIONAL,
      { state: 'EXCLUDED', reason: 'Covered in the client’s own induction at the gate.' });
    chk('a Site Manager may leave an optional module out', excluded.ok === true, excluded.ok ? '' : excluded.error);
    rows = await svc.moduleDecisionsForSite(site.id);
    const opt = rows.find((r: { slug: string }) => r.slug === 'PHASEC_OPTIONAL');
    chk('  it stops being included', opt.included === false && opt.state === 'EXCLUDED');
    chk('  and the record says who decided, and why',
      opt.decidedByName === 'Sam Manager' && /client’s own induction/.test(opt.reason));
    chk('  the resolver agrees — this is what the video will do',
      !(await svc.resolveModulesForSite(site.id)).some((r: { slug: string }) => r.slug === 'PHASEC_OPTIONAL'));

    const mandatory = await svc.setSiteModuleDecision(manager, site.id, made.PHASEC_MANDATORY,
      { state: 'EXCLUDED', reason: 'We would rather not say this one.' });
    chk('a MANDATORY module cannot be left out', mandatory.ok === false, mandatory.ok ? '' : mandatory.error);

    console.log('\n[3] Changing the wording is a Director’s');
    const smOverride = await svc.setSiteModuleDecision(manager, site.id, made.PHASEC_MANDATORY, {
      state: 'OVERRIDDEN', reason: 'The client insists on different wording.',
      overrideNarration: 'On this project you must also sign the visitor book before entering any work area.',
    });
    chk('a Site Manager may NOT change company wording', smOverride.ok === false, smOverride.ok ? '' : smOverride.error);
    chk('  and is told what they CAN do instead', /leave a module out/i.test(smOverride.error));

    const shortWording = await svc.setSiteModuleDecision(director, site.id, made.PHASEC_MANDATORY,
      { state: 'OVERRIDDEN', reason: 'The client insists on different wording.', overrideNarration: 'Too short.' });
    chk('a replacement too short to be a briefing is refused', shortWording.ok === false);

    const overridden = await svc.setSiteModuleDecision(director, site.id, made.PHASEC_MANDATORY, {
      state: 'OVERRIDDEN', reason: 'The client requires the visitor book to be named.',
      overrideNarration: 'Treat everyone on site with respect, stop anything unsafe, and sign the visitor book before entering any work area.',
    });
    chk('a Director may', overridden.ok === true, overridden.ok ? '' : overridden.error);
    const resolved = await svc.resolveModulesForSite(site.id);
    const man = resolved.find((r: { slug: string }) => r.slug === 'PHASEC_MANDATORY');
    chk('  the project’s words are what the video will say', /visitor book/.test(man.narration));
    chk('  and it is flagged as a departure, with the reason',
      man.overridden === true && /visitor book to be named/.test(man.overrideReason));

    console.log('\n[4] Going back to the company standard');
    const back = await svc.setSiteModuleDecision(director, site.id, made.PHASEC_MANDATORY, { state: 'DEFAULT' });
    chk('the decision can be withdrawn', back.ok === true);
    const after = (await svc.resolveModulesForSite(site.id)).find((r: { slug: string }) => r.slug === 'PHASEC_MANDATORY');
    chk('  the company words come back', /Treat everyone on site/.test(after.narration) && after.overridden === false);
    chk('  and no row is left behind saying "no decision"',
      (await prisma.siteInductionModule.count({ where: { jobSiteId: site.id, moduleId: made.PHASEC_MANDATORY } })) === 0);

    console.log('\n[5] One resolver behind both the screen and the script');
    const service = read('services/inductionModules/inductionModuleService.ts');
    chk('the decisions screen is built from resolveModulesForSite',
      /moduleDecisionsForSite[\s\S]{0,900}resolveModulesForSite\(siteId\)/.test(service));
    chk('the write is by id, so the closed-project guard can still resolve the site',
      /findFirst\(\{/.test(service) &&
        /update\(\{ where: \{ id: existing\.id \}/.test(service) &&
        !/siteInductionModule\.upsert/.test(service));
    const route = read('app/api/platform/sites/[id]/induction-modules/route.ts');
    chk('the route applies the induction video access test',
      /canWorkOnVideoSite\(viewer, params\.id\)/.test(route));
    const panel = flat('components/platform/SiteInductionModules.tsx');
    chk('a departure is visible on the panel, not just in the database',
      /Left out of this project/.test(panel) && /Changed for this project/.test(panel));
    chk('  and an automatic omission explains itself',
      /never told the same thing twice/i.test(panel));
    chk('the panel warns that existing videos are not silently changed',
      /out of date/.test(panel));
  } catch (e: any) {
    console.log(`  ERROR ${e.message}`);
    fails++;
  } finally {
    await prisma.inductionModule.deleteMany({ where: { slug: { in: SLUGS } } });
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
