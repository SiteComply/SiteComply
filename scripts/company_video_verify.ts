export {};
/**
 * A COMPANY VIDEO, FROM MODULE TO LIBRARY REVISION.
 *
 * The properties that matter:
 *  - THE WORDING IS NOT CHANGED. The module was written and issued by a Director; the
 *    model never sees it and the split is mechanical. Every word of the script must be
 *    traceable to the module.
 *  - ONE PIPELINE. The same statuses, the same jobs, the same audit trail, the same
 *    approval as a site induction.
 *  - PUBLISHING FILES A DRAFT REVISION, not a live one: issuing to every project stays
 *    a separate decision with its own consequence screen.
 *  - NOTHING SITE-SCOPED LEAKS IN: no project authority, no site manifest, no
 *    per-project module override.
 *  - THE RENDER IS ALREADY A SEGMENT, so no transcode job is created.
 *
 * Run: npx tsx scripts/company_video_verify.ts
 */
const { prisma } = require('../lib/prisma');
const cvs = require('../services/inductionVideo/companyVideoService');
const lib = require('../services/inductionVideo/libraryAssetService');
const mod = require('../services/inductionModules/inductionModuleService');
const { moduleActorFromPlatformViewer, moduleActorFromAdmin } =
  require('../services/inductionModules/moduleActor');
const { videoActorFromModuleActor, mayWorkOn } = require('../services/inductionVideo/videoActor');
const { mediaOwnerId, videoDisplayName, isCompanyVideo } =
  require('../services/inductionVideo/videoOwner');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const director = moduleActorFromPlatformViewer(
  { id: 'cv', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'cv2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);
const adminOwner = moduleActorFromAdmin(
  { typ: 'admin', adminId: 'a1', email: 'a@b.c', name: 'Ada', role: 'OWNER', iat: 0, exp: 0 } as never);

const SLUG = 'CV_TEST_PPE';
const MOD_SLUG = 'CV_TEST_MODULE';
const NARRATION =
  'Everyone on this site wears a hard hat, boots and a hi-vis vest at all times. ' +
  'Eye protection is required for cutting, grinding and drilling.\n\n' +
  'If your PPE is damaged, tell your supervisor and replace it before you start work. ' +
  'Nobody is expected to work in broken kit.';

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
  await prisma.inductionModule.deleteMany({ where: { slug: MOD_SLUG } });
  try {
    console.log('\nTHE SPLIT DOES NOT CHANGE A WORD');
    const chunks = cvs.splitModuleNarration(NARRATION);
    chk('the wording is split into more than one scene', chunks.length >= 2, `${chunks.length} scenes`);
    const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    const original = NARRATION.replace(/\s+/g, ' ').trim();
    chk('every word survives, in order', rejoined === original,
      rejoined === original ? '' : `\n    got:      ${rejoined}\n    expected: ${original}`);
    chk('paragraph breaks are respected',
      chunks[0].includes('hard hat') && !chunks[0].includes('damaged'),
      'whoever wrote the module already decided where the breaks belong');
    chk('a single long paragraph is still broken up',
      cvs.splitModuleNarration('One. Two. Three. Four. Five. Six.').length >= 3,
      'one unbroken block must not become one unreadable card');
    chk('empty wording yields nothing rather than an empty scene',
      cvs.splitModuleNarration('   ').length === 0);
    chk('the model is never asked about module wording',
      /COMPANY MODULES ARE NOT SENT TO THE MODEL AT ALL/.test(
        read('services/inductionVideo/scriptService.ts')),
      'the rule this service follows');

    console.log('\nSETTING IT UP');
    // Modules are catalogue rows; the service drafts and issues REVISIONS of them.
    const moduleRow = await prisma.inductionModule.create({
      data: {
        slug: MOD_SLUG, title: 'PPE expectations test', category: 'SAFETY',
        order: 99, mandatory: false, defaultIncluded: true, active: true,
      },
    });
    const m = await mod.startDraft(director, moduleRow.id);
    chk('a module revision can be drafted', m.ok === true, m.error ?? '');
    const saved = await mod.saveDraft(director, m.value.revisionId, {
      heading: 'PPE expectations', narration: NARRATION,
    });
    chk('  and its wording saved', saved.ok === true, saved.error ?? '');
    const issued = await mod.issueRevision(director, m.value.revisionId, 'First issue.');
    chk('  and issued', issued.ok === true, issued.error ?? '');

    const a = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'PPE expectations', placement: 'COMPANY_BAND', category: 'PPE',
      provenance: 'GENERATED', moduleId: moduleRow.id,
    });
    chk('a GENERATED library asset can be created', a.ok === true, a.error ?? '');
    const assetId = a.value.assetId;

    const noModule = await lib.createLibraryAsset(director, {
      slug: SLUG + '_X', title: 'No source', placement: 'COMPANY_BAND', provenance: 'GENERATED',
    });
    chk('a generated asset with no module is refused',
      noModule.ok === false && /needs the company module/i.test(noModule.error ?? ''),
      noModule.error ?? 'it was accepted');

    console.log('\nPRODUCING IT — ONE PIPELINE, NOT TWO');
    const vActor = videoActorFromModuleActor(director);
    const started = await cvs.startCompanyVideo(vActor, assetId);
    chk('a Director can start a production', started.ok === true, started.error ?? '');
    const videoId = started.value.videoId;
    const video = await prisma.inductionVideo.findUnique({
      where: { id: videoId }, include: { scenes: { orderBy: { order: 'asc' } }, events: true },
    });
    chk('it is a COMPANY video', video.scope === 'COMPANY' && video.jobSiteId === null);
    chk('  in the SAME table as site inductions', Boolean(video.version) && Boolean(video.status),
      'a second set of tables would mean a second audit trail and two places for every fix');
    chk('it starts at SCRIPT_READY, with nothing to wait for',
      video.status === 'SCRIPT_READY',
      'there is no script to generate: the wording is already approved');
    chk('the scenes carry the module wording verbatim',
      video.scenes.map((s: { narration: string }) => s.narration).join(' ') === chunks.join(' '));
    chk('every scene records which module revision it came from',
      video.scenes.every((s: { moduleRevisionId: string | null }) =>
        s.moduleRevisionId === m.value.revisionId),
      'a re-issue of the module must not change an already-rendered video');
    chk('the production records it too', video.sourceModuleRevisionId === m.value.revisionId);
    chk('it is linked to the library asset', video.libraryAssetId === assetId);
    chk('the audit trail opens with how it was made',
      video.events.some((e: { action: string; detail: string | null }) =>
        e.action === 'SCRIPT_GENERATED' && /wording unchanged/.test(e.detail ?? '')));

    console.log('\nWHAT IS REFUSED');
    /*
     * A SITE MANAGER MAY PRODUCE ONE, and that is deliberate: producing a company video
     * is preparing company content, and drafting a company MODULE is already open to a
     * Site Manager. What they may not do is publish it into the Library - issuing
     * company content is a Director's decision. Asserting the wrong rule here is how I
     * discovered I had written a misleading refusal message.
     */
    chk('producing follows company-module DRAFT authority',
      videoActorFromModuleActor(manager).canManage === true,
      'a Site Manager may already draft the wording; taking the video away would be stricter');
    const managerPublish = await cvs.publishCompanyVideoToLibrary(
      videoActorFromModuleActor(manager), videoId);
    chk('  but only a Director may PUBLISH it into the Library',
      managerPublish.ok === false && /only a director/i.test(managerPublish.error ?? ''),
      managerPublish.error ?? 'a Site Manager was allowed to publish');
    const noAuthority = await cvs.startCompanyVideo(
      { ...videoActorFromModuleActor(manager), canManage: false }, assetId);
    chk('  and an actor with no company authority cannot produce at all',
      noAuthority.ok === false && /may produce a company video/i.test(noAuthority.error ?? ''),
      // Checking only `ok === false` passed with the guard deleted, because a production
      // was already in flight and ANY refusal satisfied it. Twice in one suite: a refusal
      // assertion has to say WHICH refusal.
      noAuthority.error ?? 'it was allowed');
    chk('an Admin Centre owner CAN',
      videoActorFromModuleActor(adminOwner).canManage === true);
    chk('a second production cannot run while one is in flight',
      (await cvs.startCompanyVideo(vActor, assetId)).ok === false,
      'two would race each other to publish');

    console.log('\nNOTHING SITE-SCOPED LEAKS IN');
    chk('authority is company authority, not project membership',
      mayWorkOn(vActor, { jobSiteId: null }) === true &&
        mayWorkOn({ ...vActor, canManage: false }, { jobSiteId: null }) === false);
    chk('  and company authority is NOT authority over a site induction',
      vActor.maySite('any-site') === false,
      'a different question with a different answer');
    chk('media partitions under the asset, not a project',
      mediaOwnerId({ id: videoId, jobSiteId: null, libraryAssetId: assetId }) === assetId);
    chk('  while a site video partitions exactly where it always did',
      mediaOwnerId({ id: 'v', jobSiteId: 'site-1', libraryAssetId: null }) === 'site-1',
      'existing audio, captions and renders must stay findable');
    chk('it is named by its library asset',
      videoDisplayName({ jobSite: null, libraryAsset: { title: 'PPE expectations' } })
        === 'PPE expectations');
    chk('the script drain refuses a company video outright',
      /if \(!job\.video\.jobSite\) \{/.test(
        read('services/inductionVideo/inductionVideoService.ts')),
      // Matching the message text passed even with the guard deleted: the string stayed
      // in the file. Assert the CONDITION, not the words it would print.
      'a company video has no script job; if one appears, the failure must be visible');
    chk('per-project module overrides are skipped',
      /video\.jobSiteId\s*\n?\s*\? await overriddenRevisionIds/.test(
        read('components/inductionVideo/VideoVersionSurface.tsx')));
    chk('superseding is scoped to the ASSET, not to "every video with no site"',
      /\{ libraryAssetId: current\.libraryAssetId \}/.test(
        read('services/inductionVideo/inductionVideoService.ts')),
      'jobSiteId: null would sweep every company video of every asset into one pile');

    console.log('\nPUBLISHING FILES A DRAFT REVISION, NOT A LIVE ONE');
    const tooEarly = await cvs.publishCompanyVideoToLibrary(vActor, videoId);
    chk('publishing before rendering is refused',
      tooEarly.ok === false && /render the video/i.test(tooEarly.error ?? ''),
      tooEarly.error ?? '');
    // Stand in for the render and narration the queue would have done.
    await prisma.inductionVideo.update({
      where: { id: videoId },
      data: { status: 'VIDEO_READY', videoBlobPath: `induction-video/${assetId}/${videoId}/video-x.mp4` },
    });
    const noCaptions = await cvs.publishCompanyVideoToLibrary(vActor, videoId);
    chk('publishing with no caption track is refused',
      noCaptions.ok === false && /caption/i.test(noCaptions.error ?? ''),
      'a library video cannot be issued without captions, so producing one without them is a dead end');
    await prisma.inductionVideo.update({
      where: { id: videoId },
      data: { captionsBlobPath: `induction-video/${assetId}/${videoId}/captions.vtt` },
    });
    for (const s of await prisma.inductionVideoScene.findMany({ where: { videoId } })) {
      await prisma.inductionVideoScene.update({
        where: { id: s.id }, data: { audioDurationMs: 6000 },
      });
    }
    const published = await cvs.publishCompanyVideoToLibrary(vActor, videoId);
    chk('a complete production publishes', published.ok === true, published.error ?? '');
    const rev = await prisma.libraryAssetRevision.findUnique({
      where: { id: published.value.revisionId },
    });
    chk('it lands as a DRAFT revision', rev.status === 'DRAFT',
      'issuing it to every project stays a separate decision, with its own consequence screen');
    chk('the RENDER is the segment — nothing to transcode',
      rev.normalisedBlobPath?.includes('video-x.mp4') === true,
      'same renderer, same spec, so it is already a valid library segment');
    chk('  and no transcode job was created',
      (await prisma.libraryNormaliseJob.count({ where: { revisionId: rev.id } })) === 0);
    chk('the captions came free with the narration',
      rev.captionsBlobPath?.endsWith('captions.vtt') === true);
    chk('the duration is the sum of the narration', rev.durationMs === 12000, `${rev.durationMs}ms`);
    chk('the revision records the module revision it came from',
      rev.sourceModuleRevisionId === m.value.revisionId);
    chk('  so it is still not editable in the Library',
      (await lib.attachUpload(director, rev.id, {
        kind: 'VIDEO', blobPath: 'x', fileName: 'x.mp4', bytes: 1,
      })).ok === false,
      'the module stays the source of truth');
    const after = await prisma.inductionVideo.findUnique({ where: { id: videoId } });
    chk('the production is marked published', after.status === 'PUBLISHED' && after.publishedAt);
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: { in: [SLUG, SLUG + '_X'] } } });
    await prisma.inductionModule.deleteMany({ where: { slug: MOD_SLUG } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
