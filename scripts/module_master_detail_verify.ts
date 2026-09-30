export {};
/**
 * COMPANY MODULES AS A LIST, WITH THE CONTENT ON ITS OWN PAGE.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * The landing page rendered every module's whole narration, plus an inline edit form
 * and an inline issue form: about 2,400 words across seven modules before a click,
 * and there was no route for a single module at all. The wording now lives on
 * `modules/[moduleId]`.
 *
 * THE PROPERTIES:
 *   THE LIST CARRIES NO WORDING      not as a field, not as a query.
 *   THE ROW SAYS ENOUGH TO CHOOSE BY derived status, reach, usage, what stands in.
 *   ONE INCLUSION RULE               counting where a module is used asks the same
 *                                    predicate that builds a real induction.
 *   A DRAFT REACHES NOBODY           and the status says so in as many words.
 *   THE DETAIL PAGE CARRIES THE REST wording, revisions, usage, consequences.
 *
 * Run: npx tsx scripts/module_master_detail_verify.ts
 */
const { prisma } = require('../lib/prisma');
const svc = require('../services/inductionModules/inductionModuleService');
const rows = require('../services/inductionModules/moduleRows');
const detailSvc = require('../services/inductionModules/moduleDetail');
const usageSvc = require('../services/inductionModules/moduleUsage');
const { moduleStatus } = require('../services/inductionModules/moduleStatus');
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
  { id: 'mmd', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);

const TAG = `MMD_${process.pid}`;
const WORDING =
  'Your personal protective equipment is the last thing between you and an injury. ' +
  'Wear it properly and look after it, and tell your supervisor if any of it is damaged.';

const madeSites: string[] = [];
const madeModules: string[] = [];
const madeAssets: string[] = [];
const madeAdmins: string[] = [];

/** A JobSite needs an admin who created it; reuse one rather than inventing a fixture. */
let adminId: string | null = null;
async function anAdmin(): Promise<string> {
  if (adminId) return adminId;
  const existing = await prisma.admin.findFirst({ select: { id: true } });
  if (existing) {
    adminId = existing.id as string;
    return existing.id as string;
  }
  const made = await prisma.admin.create({
    data: {
      azureObjectId: `${TAG}-oid`, email: `${TAG}@example.invalid`,
      displayName: 'Suite Admin', role: 'ADMIN',
    },
    select: { id: true },
  });
  madeAdmins.push(made.id);
  adminId = made.id as string;
  return made.id as string;
}

async function site(name: string, status: 'ACTIVE' | 'COMPLETED' = 'ACTIVE') {
  const s = await prisma.jobSite.create({
    data: {
      name: `${TAG} ${name}`, addressLine1: '1 Way', town: 'T', postcode: 'TE1 1ST',
      jobReference: `${TAG}-${name}`, status, createdByAdminId: await anAdmin(),
    },
    select: { id: true },
  });
  madeSites.push(s.id);
  return s.id;
}

async function module_(slug: string, title: string, over: Record<string, unknown> = {}) {
  const m = await prisma.inductionModule.create({
    data: { slug: `${TAG}_${slug}`, title, order: 90, ...over },
    select: { id: true },
  });
  madeModules.push(m.id);
  return m.id;
}

async function issueWording(moduleId: string, heading: string, narration: string) {
  const d = await svc.startDraft(director, moduleId);
  if (!d.ok) throw new Error(d.error);
  const saved = await svc.saveDraft(director, d.value.revisionId, { heading, narration });
  if (!saved.ok) throw new Error(saved.error);
  const issued = await svc.issueRevision(director, d.value.revisionId, 'for the suite');
  if (!issued.ok) throw new Error(issued.error);
  return d.value.revisionId;
}

(async () => {
  try {
    console.log('\nONE INCLUSION RULE, ASKED NOT RESTATED');
    chk('resolveModulesForSite asks the shared predicate',
      /moduleReachesSite\(m, decision \?\? null\)/.test(
        code('services/inductionModules/inductionModuleService.ts')),
      'a second copy of these conditions is how a count and an induction disagree');
    chk('the usage counter asks the same one',
      /moduleReachesSite\(m, decision\)/.test(code('services/inductionModules/moduleUsage.ts')));
    // The three conditions, directly.
    chk('no decision + on by default = included',
      svc.moduleReachesSite({ mandatory: false, defaultIncluded: true }, null) === true);
    chk('no decision + off by default = left out',
      svc.moduleReachesSite({ mandatory: false, defaultIncluded: false }, null) === false,
      'an absent row is "no opinion", so the company default decides');
    chk('a site may exclude an optional module',
      svc.moduleReachesSite({ mandatory: false, defaultIncluded: true },
        { state: 'EXCLUDED' }) === false);
    chk('a site may NOT exclude a mandatory one',
      svc.moduleReachesSite({ mandatory: true, defaultIncluded: true },
        { state: 'EXCLUDED' }) === true,
      'mandatory means no project may drop it');
    chk('an override still counts as included',
      svc.moduleReachesSite({ mandatory: false, defaultIncluded: true },
        { state: 'OVERRIDDEN' }) === true,
      'different words, still this subject');

    console.log('\nTHE DERIVED STATUS SAYS WHETHER ANYBODY HEARS IT');
    chk('nothing written',
      moduleStatus({ active: true, issued: null, draft: null }).key === 'NOTHING_WRITTEN');
    const draftOnly = moduleStatus({ active: true, issued: null, draft: { version: 1 } });
    chk('a draft only', draftOnly.key === 'DRAFT_ONLY');
    chk('  and it reaches nobody', draftOnly.reachesOperatives === false,
      'the condition that let a "REPLACE THIS TEXT" module sit in production');
    chk('  and says so in words', /reaches nobody/i.test(draftOnly.detail));
    const live = moduleStatus({ active: true, issued: { version: 1 }, draft: null });
    chk('issued', live.key === 'LIVE' && live.reachesOperatives === true);
    const both = moduleStatus({ active: true, issued: { version: 1 }, draft: { version: 2 } });
    chk('live WITH a draft is its own state', both.key === 'LIVE_WITH_DRAFT',
      'it needed two places on the page to read before');
    chk('  and names both revisions',
      both.label.includes('1') && both.label.includes('2'), both.label);
    chk('retired beats everything',
      moduleStatus({ active: false, issued: { version: 3 }, draft: { version: 4 } }).key
        === 'RETIRED',
      'asking about revisions first would call a retired module live');
    chk('  and a retired module reaches nobody',
      moduleStatus({ active: false, issued: { version: 3 }, draft: null })
        .reachesOperatives === false);

    console.log('\nUSAGE IS COUNTED AGAINST REAL PROJECTS');
    const a = await site('A');
    const b = await site('B');
    const closed = await site('Closed', 'COMPLETED');
    const mMandatory = await module_('MAND', 'Mandatory subject', { mandatory: true });
    const mDefaultOn = await module_('ON', 'On by default', { defaultIncluded: true });
    const mDefaultOff = await module_('OFF', 'Off by default', { defaultIncluded: false });
    const mDraft = await module_('DRAFT', 'Never issued');
    const mRetired = await module_('RET', 'Retired subject', { active: false });
    await issueWording(mMandatory, 'Mandatory subject', WORDING);
    await issueWording(mDefaultOn, 'On by default', WORDING);
    await issueWording(mDefaultOff, 'Off by default', WORDING);
    await issueWording(mRetired, 'Retired subject', WORDING);
    // A draft, never issued.
    const dOnly = await svc.startDraft(director, mDraft);
    await svc.saveDraft(director, dOnly.value.revisionId, { heading: 'Draft', narration: WORDING });

    // Site B leaves the optional one out, and tries to leave the mandatory one out.
    await prisma.siteInductionModule.create({
      data: { jobSiteId: b, moduleId: mDefaultOn, state: 'EXCLUDED' },
    });
    await prisma.siteInductionModule.create({
      data: { jobSiteId: b, moduleId: mMandatory, state: 'EXCLUDED' },
    });
    // Site A records its own wording for the optional one.
    await prisma.siteInductionModule.create({
      data: {
        jobSiteId: a, moduleId: mDefaultOff, state: 'OVERRIDDEN',
        overrideNarration: 'Our own words for this, long enough to count as wording.',
      },
    });

    const usage = await usageSvc.moduleUsageSummaries();
    const totals = usage.get(mMandatory).totalProjects;
    chk('only ACTIVE projects are counted', totals >= 2,
      `${totals} — a module is not "missing from" a closed project`);
    const closedName = (await prisma.jobSite.findUnique({ where: { id: closed } })).name;
    chk('  the closed project is not in any exclusion list',
      !usage.get(mDefaultOn).excludedBy.some((x: { siteName: string }) => x.siteName === closedName));
    chk('a mandatory module counts on every active project despite an EXCLUDED row',
      usage.get(mMandatory).onProjects === totals,
      `${usage.get(mMandatory).onProjects} of ${totals}`);
    chk('an optional module a project excluded is not counted there',
      usage.get(mDefaultOn).onProjects === totals - 1,
      `${usage.get(mDefaultOn).onProjects} of ${totals}`);
    chk('  and that project is named so the decision is checkable',
      usage.get(mDefaultOn).excludedBy.length === 1 &&
        usage.get(mDefaultOn).excludedBy[0].siteName.includes('B'));
    chk('an off-by-default module counts only where a project opted in',
      usage.get(mDefaultOff).onProjects === 1,
      `${usage.get(mDefaultOff).onProjects} — site A recorded its own wording, which opts in`);
    chk('  and the override is reported',
      usage.get(mDefaultOff).overriddenBy.length === 1);
    chk('AN UNISSUED MODULE REACHES NOBODY, whatever the decisions say',
      usage.get(mDraft).onProjects === 0);
    chk('a RETIRED module reaches nobody either',
      usage.get(mRetired).onProjects === 0,
      'resolveModulesForSite filters on active before the predicate ever runs');

    console.log('\nTHE LIST CARRIES NO WORDING AT ALL');
    /*
     * The loader returns { rows, retired } now: the primary page gets ACTIVE rows only,
     * and only the COUNT and SLUGS of what is archived. A retired module cannot be
     * rendered there by mistake because it is not in the payload.
     */
    const index = await rows.moduleRowsForIndex();
    const list = index.rows;
    const mine = list.filter((r: { slug: string }) => r.slug.startsWith(TAG));
    chk('the four ACTIVE modules are in the list', mine.length === 4, `${mine.length}`);
    chk('  and the retired one is NOT', !mine.some((r: { slug: string }) => r.slug.endsWith('_RET')),
      'Company Modules is the active catalogue; retired content lives in the archive');
    chk('  but its slug is reported so it is not mistaken for missing',
      index.retired.slugs.some((x: string) => x.endsWith('_RET')) &&
        index.retired.count >= 1,
      `${index.retired.count} archived`);
    const archived = await rows.retiredModuleRows();
    chk('the archive loader returns it', archived.some((r: { slug: string }) => r.slug.endsWith('_RET')));
    chk('  and returns nothing active', archived.every((r: { active: boolean }) => !r.active));
    const row = mine.find((r: { id: string }) => r.id === mMandatory);
    chk('a row has no narration field', !('narration' in row),
      // THE regression. 2,400 words on the landing page is what this removes.
      Object.keys(row).join(','));
    chk('  and no heading field either', !('heading' in row));
    chk('no row anywhere carries the wording',
      !JSON.stringify(list).includes('last thing between you and an injury'),
      'the whole point: the list is for choosing, not for reading');
    chk('a row carries its derived status', row.status?.key === 'LIVE');
    chk('a row carries its usage', row.usage.onProjects === totals &&
      row.usage.totalProjects === totals);
    chk('a draft-only row says it reaches nobody',
      mine.find((r: { id: string }) => r.id === mDraft).status.reachesOperatives === false);
    chk('a retired row is in the ARCHIVE, not the list',
      archived.some((r: { id: string }) => r.id === mRetired) &&
        !list.some((r: { id: string }) => r.id === mRetired),
      'the "Show retired" checkbox is gone by the owner\'s decision');

    console.log('\nA VIDEO THAT STANDS IN FOR A MODULE IS DECLARED ON THE ROW');
    const asset = await prisma.libraryAsset.create({
      data: {
        slug: `${TAG}_ASSET`, title: 'Filmed PPE briefing', provenance: 'UPLOADED',
        placement: 'COMPANY_BAND', moduleId: mMandatory,
      },
      select: { id: true },
    });
    madeAssets.push(asset.id);
    const relisted = (await rows.moduleRowsForIndex()).rows;
    const withStandIn = relisted.find((r: { id: string }) => r.id === mMandatory);
    chk('the row names the video that replaces it',
      withStandIn.standsInFor?.title === 'Filmed PPE briefing',
      // Without this a module reads as reaching every project when a film is what plays.
      JSON.stringify(withStandIn.standsInFor));
    chk('  and a module with no stand-in says null',
      relisted.find((r: { id: string }) => r.id === mDefaultOn).standsInFor === null);

    console.log('\nTHE DETAIL PAGE CARRIES WHAT THE LIST DROPPED');
    const detail = await detailSvc.moduleDetail(mMandatory);
    chk('it exists for a real module', detail !== null);
    chk('THE WORDING IS HERE', detail.inForce.narration.includes('last thing between you'),
      'the list dropped it, so this has to carry it');
    chk('  with the heading shown on screen', detail.inForce.heading === 'Mandatory subject');
    chk('  and it is marked as in force, not a draft', detail.inForce.isDraft === false);
    chk('the revisions are listed', detail.revisions.length >= 1);
    chk('  each with what it said, so a past induction can be shown',
      detail.revisions.every((r: { narration: string }) => r.narration.length > 0));
    chk('usage is the same figure the list showed',
      detail.usage.onProjects === withStandIn.usage.onProjects);
    chk('the stand-in video is named', detail.standsInFor?.title === 'Filmed PPE briefing');
    chk('  and flagged as having nothing issued yet',
      detail.standsInFor?.hasIssuedRevision === false,
      'a video set to replace a module but never issued replaces nothing');
    chk('retiring says what it would do, in projects',
      /removes this subject from \d+ active/.test(detail.retireConsequence),
      detail.retireConsequence);

    const draftDetail = await detailSvc.moduleDetail(mDraft);
    chk('a never-issued module shows the draft wording rather than an empty panel',
      draftDetail.inForce.isDraft === true &&
        draftDetail.inForce.narration.includes('last thing between you'));
    chk('  and issuing says what it will do BEFORE anybody presses it',
      typeof draftDetail.issueConsequence === 'string' &&
        /nobody hears it|operatives are told/.test(draftDetail.issueConsequence),
      draftDetail.issueConsequence);
    chk('an unknown module is not found',
      (await detailSvc.moduleDetail('no-such-module')) === null);

    console.log('\nBOTH TIERS SHARE ONE LIST AND ONE EDITOR');
    const pPage = code('app/platform/dashboard/induction-videos/modules/page.tsx');
    const aPage = code('app/admin/(dashboard)/induction-videos/modules/page.tsx');
    const pDetail = code('app/platform/dashboard/induction-videos/modules/[moduleId]/page.tsx');
    const aDetail = code('app/admin/(dashboard)/induction-videos/modules/[moduleId]/page.tsx');
    chk('both lists render the shared component',
      /<ModulesIndex/.test(pPage) && /<ModulesIndex/.test(aPage));
    chk('both detail pages render the shared component',
      /<ModuleDetail/.test(pDetail) && /<ModuleDetail/.test(aDetail));
    chk('both build rows with the shared builder',
      /moduleRowsForIndex\(\)/.test(pPage) && /moduleRowsForIndex\(\)/.test(aPage));
    chk('both load the detail with the shared loader',
      /moduleDetail\(params\.moduleId\)/.test(pDetail) &&
        /moduleDetail\(params\.moduleId\)/.test(aDetail));
    chk('each passes its OWN endpoint',
      /api\/platform\/induction-modules/.test(pDetail) &&
        /api\/admin\/induction-modules/.test(aDetail));
    chk('the list links by basePath, never a callback',
      /basePath=/.test(pPage) && /basePath=/.test(aPage) &&
        !/basePath=\{\(/.test(pPage + aPage),
      'a function prop from a Server Component threw on every request in production');
    chk('neither detail page builds its own UI',
      !/useState|<textarea/.test(pDetail + aDetail),
      'two copies of this page would drift');
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { id: { in: madeAssets } } });
    await prisma.inductionModule.deleteMany({ where: { id: { in: madeModules } } });
    await prisma.jobSite.deleteMany({ where: { id: { in: madeSites } } });
    await prisma.admin.deleteMany({ where: { id: { in: madeAdmins } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
