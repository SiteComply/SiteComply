export {};
/**
 * A COMPANY PRODUCTION MUST BE REACHABLE FROM THE LIBRARY ASSET.
 *
 * ── THE DEFECT THIS SUITE EXISTS FOR ──────────────────────────────────────
 *
 * `startCompanyVideo` refuses a second production while an unpublished one exists.
 * Nothing rendered that production: `libraryAssetDetail` loaded `revisions` only, and
 * the project listings are `where: { jobSiteId }` while a company video's jobSiteId is
 * null. So the only route to one was the redirect fired once when Produce was pressed.
 *
 * In production on 2026-09-29 the Company Introduction asset was left holding a
 * SCRIPT_READY production built from the PPE EXPECTATIONS module, created before the
 * asset was re-pointed at the new COMPANY_INTRODUCTION module. It could not be
 * finished - the wording was the wrong subject - and it could not be deleted, because
 * no screen linked to it. The asset was wedged behind an error naming a version
 * nobody could see, and clearing it took a hand-written SQL script.
 *
 * THE PROPERTY: an in-flight production is visible, explicable and discardable from
 * the asset it blocks. Every check below is one sentence of that.
 *
 * Run: npx tsx scripts/library_production_visibility_verify.ts
 */
const { prisma } = require('../lib/prisma');
const cvs = require('../services/inductionVideo/companyVideoService');
const lib = require('../services/inductionVideo/libraryAssetService');
const detail = require('../services/inductionVideo/libraryDetail');
const actions = require('../services/inductionVideo/libraryActions');
const mod = require('../services/inductionModules/inductionModuleService');
const svc = require('../services/inductionVideo/inductionVideoService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { videoActorFromModuleActor } = require('../services/inductionVideo/videoActor');
const { videoOwnerHref } = require('../services/inductionVideo/videoOwner');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
/** Comments are prose and prose is not behaviour - four bugs in this codebase were
 *  assertions matching a comment. Strip them before matching code. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const director = moduleActorFromPlatformViewer(
  { id: 'lpv', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'lpv2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);

const SLUG = 'LPV_ASSET';
const OTHER_SLUG = 'LPV_OTHER_ASSET';
const MOD_A = 'LPV_MODULE_A';
const MOD_B = 'LPV_MODULE_B';

const WORDING_A =
  'Welcome to the company. Every person here is responsible for their own safety and ' +
  'for the safety of the people working beside them.\n\n' +
  'If you see something unsafe, stop and say so. Nobody is ever criticised for raising a concern.';
const WORDING_B =
  'Your personal protective equipment is the last thing between you and an injury. ' +
  'Wear it properly and look after it.';

/**
 * A module with issued wording.
 *
 * The row is created directly because modules arrive from `seedModuleCatalogue` and
 * there is no "create one" entry point; everything after that goes through the real
 * service, so the draft/issue rules are the ones the product enforces.
 */
async function issuedModule(slug: string, title: string, narration: string) {
  const row = await prisma.inductionModule.create({
    data: { slug, title, order: 90, mandatory: false, defaultIncluded: false },
  });
  const revisionId = await issueWording(row.id, title, narration);
  return { moduleId: row.id, revisionId };
}

/** Draft, write and issue one revision of a module. Returns the revision id. */
async function issueWording(moduleId: string, heading: string, narration: string) {
  const draft = await mod.startDraft(director, moduleId);
  if (!draft.ok) throw new Error(`could not draft: ${draft.error}`);
  const saved = await mod.saveDraft(director, draft.value.revisionId, { heading, narration });
  if (!saved.ok) throw new Error(`could not save: ${saved.error}`);
  const issued = await mod.issueRevision(director, draft.value.revisionId, 'for the suite');
  if (!issued.ok) throw new Error(`could not issue: ${issued.error}`);
  return draft.value.revisionId;
}

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: { in: [SLUG, OTHER_SLUG] } } });
  await prisma.inductionModule.deleteMany({ where: { slug: { in: [MOD_A, MOD_B] } } });
  try {
    const modA = await issuedModule(MOD_A, 'Company introduction', WORDING_A);
    const modB = await issuedModule(MOD_B, 'PPE expectations', WORDING_B);

    const a = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'Company Introduction', placement: 'OPENING',
      provenance: 'GENERATED', moduleId: modA.moduleId,
    });
    chk('a generated asset can be created', a.ok === true, a.error ?? '');
    const assetId = a.value.assetId;

    console.log('\nBEFORE ANYTHING IS PRODUCED, THERE IS NOTHING UNDER WAY');
    const clean = await detail.libraryAssetDetail(assetId);
    chk('the asset reports no productions', Array.isArray(clean.productions) &&
      clean.productions.length === 0, `${clean.productions?.length} found`);

    console.log('\nA PRODUCTION IS VISIBLE FROM THE ASSET THAT IT BLOCKS');
    const vActor = videoActorFromModuleActor(director);
    const started = await cvs.startCompanyVideo(vActor, assetId);
    chk('a production starts', started.ok === true, started.error ?? '');
    const videoId = started.value.videoId;

    const withProd = await detail.libraryAssetDetail(assetId);
    chk('the asset now reports exactly one production', withProd.productions.length === 1,
      `${withProd.productions.length} found — this is THE regression: it was always 0`);
    const p = withProd.productions[0];
    chk('  it is the production that was just started', p.id === videoId);
    chk('  it carries the version the refusal message names', p.version === started.value.version,
      'the message says "Version N"; if the page cannot say N, the message is unactionable');
    chk('  it carries the status', p.status === 'SCRIPT_READY', p.status);
    chk('  it says how many scenes there are', p.sceneCount === started.value.scenes,
      `${p.sceneCount} vs ${started.value.scenes}`);
    chk('  it names the module the wording actually came from',
      p.fromModuleTitle === 'Company introduction', String(p.fromModuleTitle));
    chk('  and which revision of it', p.fromModuleVersion === 1, String(p.fromModuleVersion));
    chk('  it is not flagged as a mismatch', p.mismatched === false);
    chk('  nor as out of date', p.stale === false);
    chk('  and it can be discarded', p.discardable === true && p.blockedReason === null,
      p.blockedReason ?? '');

    console.log('\nTHE REFUSAL TELLS YOU WHERE THE OBSTACLE IS');
    const second = await cvs.startCompanyVideo(vActor, assetId);
    chk('a second production is refused', second.ok === false);
    chk('  the refusal names the version', /version 1/i.test(second.error ?? ''), second.error ?? '');
    chk('  AND says where to find it',
      /under way/i.test(second.error ?? '') && /this page/i.test(second.error ?? ''),
      // The old message said only "Finish or delete it first", which was advice with
      // nowhere to take it. A refusal naming an obstacle owes the reader its location.
      second.error ?? '');

    console.log('\nA PRODUCTION BUILT FROM ANOTHER MODULE IS CALLED A MISMATCH');
    // Exactly what happened in production: the asset is re-pointed while a production
    // built from the old module is still in flight.
    await lib.updateLibraryAssetSettings(director, assetId, { moduleId: modB.moduleId });
    const repointed = await detail.libraryAssetDetail(assetId);
    const pm = repointed.productions[0];
    chk('the production is still visible after the asset is re-pointed',
      repointed.productions.length === 1 && pm.id === videoId);
    chk('  it is flagged as a mismatch', pm.mismatched === true,
      'finishing it would publish the wrong subject under this title');
    chk('  it still names the module it really came from',
      pm.fromModuleTitle === 'Company introduction', String(pm.fromModuleTitle));
    chk('  and the asset names the one it points at now',
      repointed.moduleTitle === 'PPE expectations', String(repointed.moduleTitle));
    chk('  a mismatch is NOT reported as mere staleness', pm.stale === false,
      'they need different advice: discard and reproduce, against pick up new wording');

    console.log('\nRE-ISSUING THE SAME MODULE IS STALENESS, WHICH IS A DIFFERENT THING');
    await lib.updateLibraryAssetSettings(director, assetId, { moduleId: modA.moduleId });
    const revisionTwo = await issueWording(
      modA.moduleId, 'Company introduction', WORDING_A + '\n\nOne more paragraph to say.',
    );
    chk('the module can be edited and issued again', revisionTwo !== modA.revisionId);
    const drifted = await detail.libraryAssetDetail(assetId);
    chk('the production is now out of date', drifted.productions[0].stale === true);
    chk('  but not a mismatch', drifted.productions[0].mismatched === false,
      'same module, newer wording');

    console.log('\nSOMETHING RUNNING ON IT HOLDS IT — THE ROW IS THE JOB\'S LOCK');
    const job = await prisma.inductionVideoJob.create({
      data: { videoId, kind: 'NARRATION', status: 'QUEUED' },
    });
    const locked = await detail.libraryAssetDetail(assetId);
    chk('it is not offered for discard while a job is queued',
      locked.productions[0].discardable === false);
    chk('  and says why', /still running/i.test(locked.productions[0].blockedReason ?? ''),
      locked.productions[0].blockedReason ?? '');
    const refusedWhileLocked = await actions.handleLibraryAction(director,
      { action: 'discardProduction', assetId, videoId });
    chk('  and the service refuses it too', refusedWhileLocked.status === 400,
      'the page must never offer what the service would refuse, nor withhold what it allows');
    await prisma.inductionVideoJob.delete({ where: { id: job.id } });

    console.log('\nTHE WEDGE CAN BE ESCAPED WITHOUT TOUCHING THE DATABASE BY HAND');
    const notMine = await actions.handleLibraryAction(director, {
      action: 'discardProduction', assetId, videoId: 'no-such-video',
    });
    chk('discarding an unknown production is refused', notMine.status === 400);

    const other = await lib.createLibraryAsset(director, {
      slug: OTHER_SLUG, title: 'Another video', placement: 'CLOSING',
      provenance: 'GENERATED', moduleId: modB.moduleId,
    });
    const otherProd = await cvs.startCompanyVideo(vActor, other.value.assetId);
    const crossAsset = await actions.handleLibraryAction(director, {
      action: 'discardProduction', assetId, videoId: otherProd.value.videoId,
    });
    chk('a production belonging to ANOTHER asset cannot be discarded through this one',
      crossAsset.status === 400 &&
        /does not belong to this library video/i.test(String(crossAsset.payload.error)),
      // Without the ownership check this endpoint deletes ANY induction video by id,
      // site inductions included, for anybody who may administer the Library.
      String(crossAsset.payload.error));
    chk('  and it is still there afterwards',
      (await prisma.inductionVideo.count({ where: { id: otherProd.value.videoId } })) === 1);

    const managerDiscard = await actions.handleLibraryAction(manager,
      { action: 'discardProduction', assetId, videoId });
    chk('a Site Manager may not discard one',
      managerDiscard.status === 400,
      // Producing follows DRAFT authority, discarding follows the irreversible-decision
      // rule - deleteVideoVersion requires canApprove, which for a company video is the
      // module's canIssue: a Director. A Site Manager can start one and cannot throw it
      // away.
      String(managerDiscard.payload.error));
    chk('  and the refusal does not claim Site Managers may',
      /only a director/i.test(String(managerDiscard.payload.error)) &&
        !/site manager/i.test(String(managerDiscard.payload.error)),
      // The shared message named "a Director or Site Manager", which is true of a SITE
      // induction and false here - so it told a Site Manager that Site Managers may do
      // the thing it was refusing them.
      String(managerDiscard.payload.error));

    const discarded = await actions.handleLibraryAction(director,
      { action: 'discardProduction', assetId, videoId });
    chk('a Director can discard it', discarded.status === 200,
      String(discarded.payload.error ?? ''));
    chk('  the production is gone',
      (await prisma.inductionVideo.count({ where: { id: videoId } })) === 0);
    chk('  its scenes went with it',
      (await prisma.inductionVideoScene.count({ where: { videoId } })) === 0);
    const cleared = await detail.libraryAssetDetail(assetId);
    chk('  the asset reports nothing under way', cleared.productions.length === 0);

    const again = await cvs.startCompanyVideo(vActor, assetId);
    chk('AND A FRESH PRODUCTION CAN NOW START', again.ok === true, again.error ?? '');
    chk('  built from the CURRENT wording',
      (await prisma.inductionVideo.findUnique({
        where: { id: again.value.videoId }, select: { sourceModuleRevisionId: true },
      })).sourceModuleRevisionId === revisionTwo,
      'the whole point of discarding rather than finishing');

    console.log('\nA PUBLISHED PRODUCTION IS HISTORY, NOT SOMETHING UNDER WAY');
    await prisma.inductionVideo.update({
      where: { id: again.value.videoId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    const afterPublish = await detail.libraryAssetDetail(assetId);
    chk('it is no longer listed as under way', afterPublish.productions.length === 0,
      'the page must list exactly what the refusal counts: anything not published');
    chk('  and a new production may start', (await cvs.startCompanyVideo(vActor, assetId)).ok === true);

    console.log('\nTHE PAGE ASKS THE SERVICE\'S OWN PREDICATE');
    chk('libraryDetail imports versionMayBeDeleted rather than restating it',
      /versionMayBeDeleted/.test(code('services/inductionVideo/libraryDetail.ts')),
      'a second copy of "may this be deleted" is how the two disagree');
    chk('  and the predicate still refuses a published version',
      svc.versionMayBeDeleted({
        status: 'PUBLISHED', publishedAt: new Date(), supersededAt: null, viewCount: 0,
      }) === false);
    chk('  and one somebody has watched',
      svc.versionMayBeDeleted({
        status: 'SCRIPT_READY', publishedAt: null, supersededAt: null, viewCount: 1,
      }) === false);

    console.log('\nNO SCREEN BUILDS A PATH OUT OF A NULL SITE');
    for (const f of [
      'app/platform/dashboard/induction-videos/[videoId]/page.tsx',
      'app/admin/(dashboard)/induction-videos/[videoId]/page.tsx',
    ]) {
      const src = code(f);
      chk(`${f} does not interpolate jobSiteId into a URL`,
        !/\$\{video\.jobSiteId\}/.test(src),
        'a company video has none, so this built /sites/null/induction-video');
      chk(`  and asks videoOwnerHref instead`, /videoOwnerHref\(/.test(src));
    }
    chk('videoOwnerHref sends a company video to its library asset',
      videoOwnerHref({ jobSiteId: null, libraryAssetId: 'asset-1' },
        { forSite: (s: string) => `/site/${s}`, forAsset: (x: string) => `/library/${x}`,
          whenNeither: '/none' }) === '/library/asset-1');
    chk('  a site video exactly where it always went',
      videoOwnerHref({ jobSiteId: 'site-9', libraryAssetId: null },
        { forSite: (s: string) => `/site/${s}`, forAsset: (x: string) => `/library/${x}`,
          whenNeither: '/none' }) === '/site/site-9');
    chk('  and a row with neither goes somewhere real',
      videoOwnerHref({ jobSiteId: null, libraryAssetId: null },
        { forSite: (s: string) => `/site/${s}`, forAsset: (x: string) => `/library/${x}`,
          whenNeither: '/none' }) === '/none');
    chk('getVideo loads the library asset so a company version can be named',
      /libraryAsset: \{ select: \{ id: true, title: true \} \}/.test(
        code('services/inductionVideo/inductionVideoService.ts')),
      'without it videoDisplayName always fell through to "Company induction"');

    console.log('\nTHE PANEL IS MOUNTED, AND THE CLIENT STAYS CLEAN');
    const ui = code('components/inductionVideo/LibraryAssetDetail.tsx');
    chk('the asset page renders the productions it is given',
      /asset\.productions/.test(ui),
      // "Imported" is not "mounted": a page that reads the data and renders nothing
      // looks identical to the bug being fixed.
      'loading productions and not rendering them is the original defect');
    chk('  it links to each one', /videoHrefBase\}\/\$\{p\.id\}/.test(ui));
    chk('  it offers the discard action', /action: 'discardProduction'/.test(ui));
    chk('  and the Produce button is blocked while one is under way',
      // Scoped to the `disabled` expression. A bare /underWay\.length > 0/ SURVIVED
      // this mutation: the same test appears in the warning paragraph above the
      // button, so deleting the guard left the assertion passing on the other one.
      /disabled=\{[^}]*underWay\.length > 0/.test(ui),
      'walking into a refusal that a panel above already explains');
    chk('the client component does not value-import a Prisma service',
      !/^import \{[^}]*\} from '@\/services\/inductionVideo\/libraryDetail'/m.test(
        read('components/inductionVideo/LibraryAssetDetail.tsx')) ||
      /import type/.test(read('components/inductionVideo/LibraryAssetDetail.tsx')),
      'a value import would ship Prisma to the browser');
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: { in: [SLUG, OTHER_SLUG] } } });
    await prisma.inductionModule.deleteMany({ where: { slug: { in: [MOD_A, MOD_B] } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
