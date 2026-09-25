export {};
/**
 * THE VIDEO LIBRARY: reusable footage assembled into generated inductions.
 *
 * THE PROPERTIES THAT MATTER:
 *  - ONE FRAMERATE. The renderer joins by stream copy, so a static scene and a
 *    piece of film cannot differ. 25, chosen for the hardest content rather than
 *    the easiest.
 *  - A DRAFT REACHES NOBODY, and neither does a revision whose upload has not been
 *    transcoded: it cannot be concatenated, so it must not appear in a manifest
 *    that claims it will be.
 *  - CAPTIONS ARE REQUIRED TO ISSUE, because a segment without them leaves the
 *    finished subtitles silent for its duration.
 *  - FOOTAGE REPLACES THE MODULE IT COVERS. The six starter modules and the obvious
 *    library videos are the same six subjects; playing both tells an operative the
 *    same thing twice.
 *  - THE SCENE CARRIES THE PATH. A published video must not change because an asset
 *    was later re-issued or retired.
 *  - RE-ISSUING MARKS VIDEOS OUT OF DATE, exactly as re-issuing a module does.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/inductionvideo_library_verify.ts
 */
const { prisma } = require('../lib/prisma');
const lib = require('../services/inductionVideo/libraryAssetService');
const { buildSceneManifest, manifestHash } = require('../services/inductionVideo/sceneRules');
const { buildVtt, buildCues, shiftVttCues } = require('../services/inductionVideo/captions');
const { VIDEO_FORMAT } = require('../services/inductionVideo/videoFormat');
const { moduleActorFromPlatformViewer, moduleActorFromAdmin } =
  require('../services/inductionModules/moduleActor');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const director = moduleActorFromPlatformViewer(
  { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'u2', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);
const adminOwner = moduleActorFromAdmin(
  { typ: 'admin', adminId: 'a1', email: 'a@b.c', name: 'Ada', role: 'OWNER', iat: 0, exp: 0 } as never);

const SLUGS = ['TEST_LIB_INTRO', 'TEST_LIB_PPE'];

/** A minimal manifest source; only the library and module lists matter here. */
const source = (over: Record<string, unknown> = {}) => ({
  siteId: 's1', siteName: 'Test', address: 'A', jobReference: 'R',
  inductionNotes: null, project: null, duty: null, siteManager: null,
  emergency: { fireAssemblyPoint: 'Rear', firstAiderName: 'Fay', firstAiderNumber: null,
    firstAiderLocation: 'Office', nearestHospital: null, emergencyNumber: null },
  keyPeople: [],
  info: { workingHours: null, welfareFacilities: null, siteHazards: null,
    emergencyProcedures: 'Stop work and go to the assembly point.', existingSiteRisks: null,
    temporaryWorks: null, trafficManagement: null, deliveryProcedures: null, accessEgress: null,
    environmentalControls: null, utilitiesIsolation: null, highRiskActivities: null,
    fireArrangements: null, hasSiteMap: false },
  incidentReporting: null, risks: [], permitTypes: [], ramsDocuments: [],
  modules: [], library: [], siteRules: ['Hard hat at all times.'], ppe: ['Hard hat'],
  ...over,
});

const footage = (over: Record<string, unknown> = {}) => ({
  assetId: 'a1', slug: 'INTRO', title: 'Company introduction',
  placement: 'OPENING', order: 0, revisionId: 'rev-1',
  blobPath: 'library/a1/rev-1/segment.mp4',
  captionsBlobPath: 'library/a1/rev-1/captions.vtt',
  durationMs: 30_000, replacesModuleId: null, ...over,
});

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: { in: SLUGS } } });
  try {
    console.log('\nONE FRAMERATE, FOR THE HARDEST CONTENT');
    chk('the pipeline runs at 25 fps', VIDEO_FORMAT.fps === 25,
      'film at ten judders, and a stream-copy join cannot mix rates');
    const norm = read('services/inductionVideo/libraryNormaliser.ts');
    chk('the normaliser imports the spec rather than repeating it',
      /from '@\/services\/inductionVideo\/videoFormat'/.test(norm) &&
      /const \{ width, height, fps \} = VIDEO_FORMAT/.test(norm),
      'two copies of an output spec would agree until somebody changed one');
    chk('it pads rather than crops', /force_original_aspect_ratio=decrease/.test(norm) &&
      /pad=\$\{width\}:\$\{height\}/.test(norm),
      'cropping silently decides the sides of somebody’s footage did not matter');
    chk('it forces an audio stream even for silent footage',
      /anullsrc=channel_layout=stereo:sample_rate=44100/.test(norm),
      'a segment with no audio stream cannot be concatenated with ones that have');
    chk('it matches the renderer’s audio spec',
      /'-ar', '44100'/.test(norm) && /'-ac', '2'/.test(norm));

    console.log('\nWHERE FOOTAGE SITS IN THE RUNNING ORDER');
    const opening = buildSceneManifest(source({ library: [footage({ placement: 'OPENING' })] }));
    const types = opening.scenes.map((s: { sceneType: string }) => s.sceneType);
    chk('an OPENING video comes before the welcome',
      types.indexOf('LIBRARY_SEGMENT') === 0 && types.indexOf('WELCOME') === 1, types.join(' '));
    const closing = buildSceneManifest(source({ library: [footage({ placement: 'CLOSING' })] }));
    const ct = closing.scenes.map((s: { sceneType: string }) => s.sceneType);
    chk('a CLOSING video comes after the site rules and before the close',
      ct.indexOf('LIBRARY_SEGMENT') > ct.indexOf('SITE_RULES') &&
      ct.indexOf('LIBRARY_SEGMENT') < ct.indexOf('CLOSING'), ct.join(' '));
    const band = buildSceneManifest(source({ library: [footage({ placement: 'COMPANY_BAND' })] }));
    const bt = band.scenes.map((s: { sceneType: string }) => s.sceneType);
    chk('a COMPANY_BAND video sits between the site content and the rules',
      bt.indexOf('LIBRARY_SEGMENT') > bt.indexOf('EMERGENCY_PROCEDURES') &&
      bt.indexOf('LIBRARY_SEGMENT') < bt.indexOf('SITE_RULES'), bt.join(' '));

    console.log('\nFOOTAGE IS NOT GENERATED, AND NOT NARRATED');
    const scene = opening.scenes.find((s: { sceneType: string }) => s.sceneType === 'LIBRARY_SEGMENT');
    chk('the scene is marked as coming from the library', scene.source === 'LIBRARY');
    chk('it carries the revision, the segment and its captions',
      scene.libraryRevisionId === 'rev-1' &&
      scene.libraryBlobPath === 'library/a1/rev-1/segment.mp4' &&
      scene.libraryCaptionsBlobPath === 'library/a1/rev-1/captions.vtt');
    chk('it is required — a site cannot drop it from the script editor', scene.required === true);
    chk('the model is never handed it',
      /const siteScenes = manifest\.scenes\.filter\(\(s\) => s\.source === 'SITE'\);/
        .test(read('services/inductionVideo/scriptService.ts')));
    chk('narration skips it', /if \(scene\.libraryRevisionId\) \{/.test(
      read('services/inductionVideo/narrationService.ts')));
    chk('and it is never counted as speech to buy',
      /!s\.libraryRevisionId &&/.test(read('services/inductionVideo/narrationService.ts')),
      'quoting a price for speech nobody will synthesise');

    console.log('\nFOOTAGE REPLACES THE MODULE IT COVERS');
    const mod = {
      moduleId: 'm1', slug: 'PPE_EXPECTATIONS', title: 'PPE expectations', order: 10,
      revisionId: 'mr1', version: 1, heading: 'PPE', narration: 'Wear it.',
      replacesSceneType: null, overridden: false, overrideReason: null,
    };
    const both = buildSceneManifest(source({
      modules: [mod],
      library: [footage({ placement: 'COMPANY_BAND', replacesModuleId: 'm1' })],
    }));
    const kinds = both.scenes.map((s: { source: string }) => s.source);
    chk('the written module is left out when footage covers it',
      kinds.filter((k: string) => k === 'MODULE').length === 0 &&
      kinds.filter((k: string) => k === 'LIBRARY').length === 1);
    chk('  and the manager is told why',
      both.warnings.some((w: string) => /covered by a company video/.test(w)),
      both.warnings.join(' | '));
    const unrelated = buildSceneManifest(source({
      modules: [mod], library: [footage({ replacesModuleId: null })],
    }));
    chk('an unrelated video leaves the module alone',
      unrelated.scenes.filter((s: { source: string }) => s.source === 'MODULE').length === 1);

    console.log('\nRE-ISSUING FOOTAGE MARKS VIDEOS OUT OF DATE');
    const before = manifestHash(buildSceneManifest(source({ library: [footage()] })));
    const after = manifestHash(
      buildSceneManifest(source({ library: [footage({ revisionId: 'rev-2' })] })));
    chk('the manifest hash includes the library revision', before !== after,
      'without it a re-issued video would leave stale renders looking current');

    console.log('\nCAPTIONS: THE SEGMENT’S OWN CUES, RE-TIMED');
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nWelcome to the company.\n\n' +
                '2\n00:00:04.000 --> 00:00:06.500\nSafety comes first.\n';
    const shifted = shiftVttCues(vtt, 10_000, 30_000);
    chk('cues are shifted onto the finished video’s clock',
      shifted.length === 2 && shifted[0].startMs === 11_000 && shifted[0].endMs === 13_000,
      JSON.stringify(shifted[0]));
    chk('the text is left exactly as supplied',
      shifted[0].text === 'Welcome to the company.',
      're-wrapping somebody’s subtitles would be editing a record we did not write');
    const overrun = shiftVttCues(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:50.000\nToo long.\n', 0, 5_000);
    chk('a cue is clamped to the segment', overrun[0].endMs === 5_000,
      'a caption over the next scene captions the wrong picture');
    const past = shiftVttCues(
      'WEBVTT\n\n1\n00:00:40.000 --> 00:00:45.000\nAfter the end.\n', 0, 5_000);
    chk('a cue entirely past the end is dropped', past.length === 0);
    const srt = shiftVttCues('WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,000\nComma timing.\n', 0, 5_000);
    chk('comma decimals are accepted', srt.length === 1, 'SRT-derived files are handed over by mistake');
    const junk = shiftVttCues('WEBVTT\n\nNOTE nothing here\n\nnot a timing line\n', 0, 5_000);
    chk('unreadable content yields no cues rather than guessed ones', junk.length === 0);
    const spliced = buildCues([
      { heading: 'Site', narration: 'Two short sentences. And another one here.', durationMs: 8_000 },
      { heading: 'Film', narration: '', durationMs: 30_000, libraryVtt: vtt },
    ]);
    chk('a library scene contributes its cues to the finished track',
      spliced.some((c: { startMs: number }) => c.startMs === 9_000),
      'offset by the scene before it');
    chk('and the whole file still starts with a WEBVTT header',
      buildVtt([{ heading: 'Film', narration: '', durationMs: 30_000, libraryVtt: vtt }])
        .startsWith('WEBVTT'));

    console.log('\nTHE LIFECYCLE, AGAINST THE DATABASE');
    const created = await lib.createLibraryAsset(director, {
      slug: 'TEST_LIB_INTRO', title: 'Test introduction', placement: 'OPENING',
    });
    chk('a Director can add an asset', created.ok === true, created.error ?? '');
    const assetId = created.value.assetId;
    const engineer = moduleActorFromPlatformViewer(
      { id: 'u3', name: 'Eve', role: 'ENGINEER', siteIds: [] } as never);
    chk('an Engineer cannot', (await lib.createLibraryAsset(engineer, {
      slug: 'TEST_LIB_PPE', title: 'Nope', placement: 'OPENING' })).ok === false);

    const started = await lib.startRevision(manager, assetId);
    chk('a Site Manager can start a revision', started.ok === true);
    const revId = started.value.revisionId;
    chk('  and starting again returns the SAME draft',
      (await lib.startRevision(manager, assetId)).value.revisionId === revId,
      'two concurrent drafts would mean two next versions');

    let r = await lib.issueRevision(director, revId, 'First cut of the introduction');
    chk('an empty revision cannot be issued', r.ok === false, r.error);
    chk('  and it says what is missing',
      /a video file/.test(r.error) && /a caption file/.test(r.error));

    await prisma.libraryAssetRevision.update({
      where: { id: revId },
      data: { sourceBlobPath: 'x/source.mp4', sourceFileName: 's.mp4' },
    });
    r = await lib.issueRevision(director, revId, 'First cut of the introduction');
    chk('an un-transcoded upload cannot be issued', r.ok === false, r.error);
    chk('  because it could not be concatenated',
      /finish being prepared/.test(r.error));

    await prisma.libraryAssetRevision.update({
      where: { id: revId },
      data: { normalisedBlobPath: 'x/segment.mp4', durationMs: 30_000, normalisedBytes: 10 },
    });
    r = await lib.issueRevision(director, revId, 'First cut of the introduction');
    chk('CAPTIONS ARE REQUIRED to issue', r.ok === false, r.error);
    chk('  and only captions are named now', /a caption file/.test(r.error) &&
      !/a video file/.test(r.error));

    await prisma.libraryAssetRevision.update({
      where: { id: revId }, data: { captionsBlobPath: 'x/captions.vtt' },
    });
    chk('a Site Manager may NOT issue',
      (await lib.issueRevision(manager, revId, 'Trying to issue')).ok === false);
    r = await lib.issueRevision(director, revId, 'no');
    chk('an issue note is required', r.ok === false, r.error);
    r = await lib.issueRevision(director, revId, 'First cut of the introduction');
    chk('a complete revision issues', r.ok === true, r.error ?? '');
    chk('an issued revision cannot be issued again',
      (await lib.issueRevision(director, revId, 'Again please')).ok === false);
    chk('an Admin OWNER may issue too', adminOwner.canIssue === true);

    console.log('\nWHAT A SITE RESOLVES');
    // An empty database threw "Cannot read properties of null (reading 'id')" and
    // the deploy gate reported it as a code failure. Say what is actually wrong.
    const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (!site) {
      console.log('  FAIL  no ACTIVE job site in this database - run `npx tsx prisma/seed.ts`');
      process.exit(1);
    }
    let resolved = await lib.resolveLibraryForSite(site.id);
    const mine = resolved.find((x: { slug: string }) => x.slug === 'TEST_LIB_INTRO');
    chk('an issued asset is included by default', Boolean(mine));
    chk('  and carries its transcoded segment, not the upload',
      mine.blobPath === 'x/segment.mp4');

    const ex = await lib.setSiteLibraryDecision(manager, site.id, assetId, {
      state: 'EXCLUDED', reason: 'no',
    });
    chk('leaving one out needs a real reason', ex.ok === false, ex.error);
    chk('  and with one it is left out',
      (await lib.setSiteLibraryDecision(manager, site.id, assetId,
        { state: 'EXCLUDED', reason: 'Filmed at another depot; not representative here.' })).ok === true);
    resolved = await lib.resolveLibraryForSite(site.id);
    chk('  so the site no longer resolves it',
      !resolved.some((x: { slug: string }) => x.slug === 'TEST_LIB_INTRO'));

    const decisions = await lib.libraryDecisionsForSite(site.id);
    const d = decisions.find((x: { slug: string }) => x.slug === 'TEST_LIB_INTRO');
    chk('the panel shows who decided and why',
      d.included === false && /another depot/.test(d.reason) && d.decidedByName === 'Sam Manager');

    await prisma.libraryAsset.update({ where: { id: assetId }, data: { mandatory: true } });
    chk('a MANDATORY asset cannot be left out',
      (await lib.setSiteLibraryDecision(manager, site.id, assetId,
        { state: 'EXCLUDED', reason: 'Trying it on anyway' })).ok === false);
    chk('and it cannot be retired while mandatory',
      (await lib.setLibraryAssetActive(director, assetId, false)).ok === false);

    console.log('\nA HALF-PREPARED REVISION REACHES NOBODY');
    await prisma.libraryAsset.update({ where: { id: assetId }, data: { mandatory: false } });
    await prisma.siteLibraryAsset.deleteMany({ where: { assetId } });
    await prisma.libraryAssetRevision.update({
      where: { id: revId }, data: { normalisedBlobPath: null },
    });
    resolved = await lib.resolveLibraryForSite(site.id);
    chk('an issued revision with no segment is invisible to a site',
      !resolved.some((x: { slug: string }) => x.slug === 'TEST_LIB_INTRO'),
      'it cannot be concatenated, so a manifest must not promise it');

    console.log('\nONE SYSTEM, TWO FRONT DOORS');
    for (const [label, f] of [
      ['platform', 'app/api/platform/induction-library/route.ts'],
      ['admin', 'app/api/admin/induction-library/route.ts'],
    ] as const) {
      chk(`the ${label} route uses the shared dispatcher`,
        /handleLibraryAction\(/.test(read(f)));
      chk(`the ${label} route implements no action itself`,
        !/createLibraryAsset\(|issueRevision\(|attachUpload\(/.test(read(f)));
    }
    chk('the admin route refuses a VIEWER at the door',
      /requireAdminRole\(ADMIN_WRITE_ROLES\)/.test(read('app/api/admin/induction-library/route.ts')));
    for (const [label, f] of [
      ['Platform', 'app/platform/dashboard/induction-videos/library/page.tsx'],
      ['Admin', 'app/admin/(dashboard)/induction-videos/library/page.tsx'],
    ] as const) {
      chk(`the ${label} library page exists and shares the editor`,
        existsSync(f) && /<LibrarySection/.test(read(f)) && /libraryRowsForEditor/.test(read(f)));
    }

    console.log('\nUPLOADS DO NOT PASS THROUGH THE APPLICATION');
    const acts = read('services/inductionVideo/libraryActions.ts');
    chk('an upload URL is issued for one blob', /mediaUploadUrl\(blobPath\)/.test(acts));
    chk('  write-only, and only on that path',
      /BlobSASPermissions\.parse\('cw'\)/.test(read('services/inductionVideo/mediaStorage.ts')));
    chk('  and only for a DRAFT revision',
      /rev\.status !== 'DRAFT'/.test(acts),
      'otherwise it would overwrite footage operatives are being shown');
    chk('captions must actually be a .vtt', /\\.vtt\$\/i\.test\(fileName\)/.test(acts));

    console.log('\nTHE SCENE CARRIES THE PATH, NOT A LOOKUP');
    const rs = read('services/inductionVideo/renderService.ts');
    chk('the renderer reads the segment path off the SCENE',
      /scene\.libraryBlobPath/.test(rs),
      'looking it up through the asset would let a re-issue change a published video');
    chk('a scene that is footage is passed through, not encoded',
      /segment: segment\.bytes/.test(rs));
    chk('the ffmpeg renderer concatenates it rather than drawing a frame',
      /if \(scene\.segment\) \{/.test(read('services/inductionVideo/ffmpegRenderer.ts')));
    chk('footage duration counts towards the render estimate',
      /libraryDurationMs: true/.test(rs));
    chk('library media lives outside the per-video prefix',
      /return `library\/\$\{assetId\}\/\$\{revisionId\}`/.test(
        read('services/inductionVideo/mediaStorage.ts')),
      'the retention sweep would otherwise delete a master out from under every induction');
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: { in: SLUGS } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
