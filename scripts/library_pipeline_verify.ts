export {};
/**
 * THE LIBRARY PIPELINE SURVIVES REAL OPERATION.
 *
 * The audio spec is proven on real media in library_audiospec_verify. This covers
 * the operational failures that made the feature unusable rather than wrong:
 *
 *  - an upload waited up to AN HOUR for the tick, on the slowest job in the system;
 *  - a transcode interrupted by a restart was stuck RUNNING forever, and the
 *    revision said "waiting for the upload to finish being prepared" with nothing
 *    coming;
 *  - two passes could both claim the same job and run two 1080p encodes on one core;
 *  - there was no size or duration ceiling at all, on a 1.75 GB instance.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/library_pipeline_verify.ts
 */
const { prisma } = require('../lib/prisma');
const lib = require('../services/inductionVideo/libraryAssetService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const director = moduleActorFromPlatformViewer(
  { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);

const SLUG = 'TEST_PIPE_ASSET';

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
  try {
    console.log('\nUPLOADING STARTS THE WORK, IT DOES NOT ONLY QUEUE IT');
    const svc = read('services/inductionVideo/libraryAssetService.ts');
    const kicker = read('services/inductionVideo/jobKicker.ts');
    chk('attachUpload kicks the drain', /kickInductionJobs\(\);/.test(svc),
      'without this the operator watched "Preparing the video…" for up to an hour');
    chk('the kicker actually drains normalise jobs',
      /runQueuedNormaliseJobs\(1\)/.test(kicker),
      'it drained scripts, narration and renders and omitted the slowest job of the three');
    chk('  and it is imported, not just mentioned',
      /import \{ runQueuedNormaliseJobs \}/.test(kicker));
    chk('the kick is not awaited inside the upload request',
      !/await kickInductionJobs/.test(svc),
      'a transcode must not sit inside the operator’s HTTP request');
    const tick = read('app/api/system/compliance/tick/route.ts');
    chk('the tick drains the library queue in its OWN try',
      /\}\s*catch \{[^}]*\}\s*\/\*[\s\S]{0,800}?try \{\s*libraryPrepared = await runQueuedNormaliseJobs\(1\)/
        .test(tick),
      'sharing a try with renders let one failing render starve the library for that hour');

    console.log('\nA JOB ABANDONED BY A RESTART IS RECLAIMED');
    const asset = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'Pipeline test', placement: 'OPENING', mandatory: false,
    });
    chk('an asset can be created', asset.ok === true, asset.error ?? '');
    const assetId = asset.value.assetId;
    const rev = await lib.startRevision(director, assetId);
    chk('a revision can be started', rev.ok === true, rev.error ?? '');
    const revisionId = rev.value.revisionId;

    const fresh = await prisma.libraryNormaliseJob.create({
      data: { revisionId, requestedByName: 'Test', status: 'RUNNING', startedAt: new Date() },
    });
    let picked = await lib.queuedNormaliseJobs(10);
    chk('a transcode that started moments ago is left alone',
      !picked.some((j: { id: string }) => j.id === fresh.id),
      'stealing a job from a process still encoding would run it twice');

    await prisma.libraryNormaliseJob.update({
      where: { id: fresh.id },
      data: { startedAt: new Date(Date.now() - lib.NORMALISE_STALE_AFTER_MS - 60_000) },
    });
    picked = await lib.queuedNormaliseJobs(10);
    chk('one abandoned long enough IS reclaimed',
      picked.some((j: { id: string }) => j.id === fresh.id),
      'before this it was invisible to every later pass and the revision never finished');
    chk('  and the threshold is longer than the encode timeout',
      lib.NORMALISE_STALE_AFTER_MS > 15 * 60 * 1000,
      `${Math.round(lib.NORMALISE_STALE_AFTER_MS / 60000)} min vs a 15 min ffmpeg timeout`);

    console.log('\nTWO PASSES CANNOT BOTH RUN THE SAME JOB');
    chk('the claim is conditional on the row not having changed',
      /updateMany\(\{\s*where: \{ id: job\.id, status: job\.status, startedAt: job\.startedAt \}/.test(svc),
      'a bare update let both passes proceed');
    chk('  and a pass that loses the race moves on',
      /if \(claimed\.count === 0\) continue;/.test(svc));
    // Prove it: claim it once by hand, then a second claim on the same read must fail.
    const stale = await prisma.libraryNormaliseJob.findUnique({ where: { id: fresh.id } });
    const first = await prisma.libraryNormaliseJob.updateMany({
      where: { id: stale.id, status: stale.status, startedAt: stale.startedAt },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const second = await prisma.libraryNormaliseJob.updateMany({
      where: { id: stale.id, status: stale.status, startedAt: stale.startedAt },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    chk('the first claim wins and the second sees nothing',
      first.count === 1 && second.count === 0, `${first.count} then ${second.count}`);

    console.log('\nA FILE THAT KEEPS BREAKING IS GIVEN UP ON');
    chk('there is an attempt ceiling', lib.NORMALISE_MAX_ATTEMPTS >= 2 && lib.NORMALISE_MAX_ATTEMPTS <= 5,
      String(lib.NORMALISE_MAX_ATTEMPTS));
    chk('  and it is read, not just incremented',
      /job\.attempts \+ 1 > NORMALISE_MAX_ATTEMPTS/.test(svc),
      'attempts was written and never looked at, so a crash loop was unbounded');
    await prisma.libraryNormaliseJob.update({
      where: { id: fresh.id },
      data: { status: 'QUEUED', startedAt: null, attempts: lib.NORMALISE_MAX_ATTEMPTS },
    });
    const ran = await lib.runQueuedNormaliseJobs(1);
    const after = await prisma.libraryNormaliseJob.findUnique({ where: { id: fresh.id } });
    chk('a job over the ceiling is failed rather than retried',
      after.status === 'FAILED', after.status);
    chk('  and it did not count as work done', ran === 0, String(ran));
    const revAfter = await prisma.libraryAssetRevision.findUnique({ where: { id: revisionId } });
    chk('  with the reason on the revision, where the operator is looking',
      Boolean(revAfter.normaliseError) && /will not be retried/.test(revAfter.normaliseError),
      revAfter.normaliseError ?? 'nothing recorded');

    console.log('\nTHERE IS A CEILING ON WHAT CAN BE UPLOADED');
    chk('a byte ceiling exists', lib.MAX_LIBRARY_VIDEO_BYTES > 0,
      `${lib.describeBytes(lib.MAX_LIBRARY_VIDEO_BYTES)}`);
    chk('  and it is smaller than the instance’s memory',
      lib.MAX_LIBRARY_VIDEO_BYTES < 1024 * 1024 * 1024);
    chk('a duration ceiling exists', lib.MAX_LIBRARY_VIDEO_MS > 0,
      `${Math.round(lib.MAX_LIBRARY_VIDEO_MS / 60000)} minutes`);
    chk('the ceiling is enforced against STORAGE, not the browser’s claim',
      /const props = await mediaProperties\(input\.blobPath\)/.test(svc) &&
      /sourceBytes: trueBytes/.test(svc),
      'both the size and the path came from the client');
    chk('the duration is checked after the transcode measured it',
      /durationMs > MAX_LIBRARY_VIDEO_MS/.test(svc));
    // An upload recorded against a blob that was never written must be refused.
    const ghost = await lib.attachUpload(director, revisionId, {
      kind: 'VIDEO', blobPath: `library/${assetId}/${revisionId}/never-uploaded.mp4`,
      fileName: 'never-uploaded.mp4', bytes: 1234,
    });
    chk('an attach for a blob that is not there is refused',
      ghost.ok === false && /did not arrive completely/.test(ghost.error ?? ''),
      ghost.error ?? 'it was accepted');

    console.log('\nTHE EDITOR REFUSES A HUGE FILE BEFORE UPLOADING IT');
    /*
     * FOUND BY WHICHEVER COMPONENT UPLOADS, not by name. These assertions named
     * LibrarySection.tsx and broke when uploading moved to the asset detail page in
     * the IA work - the behaviour was intact and the test was pointing at the old
     * address. Anything that PUTs a block blob must carry the guard.
     */
    const uploaders = ['components/inductionVideo/LibrarySection.tsx',
      'components/inductionVideo/LibraryAssetDetail.tsx']
      .filter((f) => /'x-ms-blob-type': 'BlockBlob'/.test(read(f)));
    chk('something in the UI uploads footage', uploaders.length > 0,
      uploaders.join(', ') || 'nothing PUTs a blob');
    const ui = uploaders.map((f) => read(f)).join('\n');
    chk('every uploading surface checks the size itself',
      uploaders.every((f) => /file\.size > MAX_LIBRARY_VIDEO_BYTES/.test(read(f))),
      'finding out after a 300 MB upload over site broadband is not a check');
    chk('  using the shared limit, not its own number',
      uploaders.every((f) =>
        /from '@\/services\/inductionVideo\/libraryLimits'/.test(read(f))));
    chk('the limits module touches no database',
      !/prisma|PrismaClient/.test(read('services/inductionVideo/libraryLimits.ts')),
      'a VALUE import from a client component pulls whatever it imports into the browser bundle');
    /*
     * MULTI-LINE IMPORTS COUNT. The previous form anchored to one line, and
     * LibraryAssetDetail's taxonomy import is wrapped across two - so it matched
     * nothing and passed regardless of what was imported. A wrapped value import of
     * a service that touches the database is precisely the mistake this exists for.
     */
    const CLIENT_SAFE = /libraryLimits|libraryTaxonomy|libraryStatus/;
    const valueImports = [...ui.matchAll(
      /^import\s+(?!type\b)[\s\S]*?from\s+'(@\/services\/[^']+)';/gm,
    )].map((m) => m[1]);
    chk('  and every uploading surface value-imports only client-safe modules',
      valueImports.length > 0 && valueImports.every((m: string) => CLIENT_SAFE.test(m)),
      valueImports.join(', ') || 'no service imports found at all — check the regex');

    console.log('\nTHE VIDEO IS NEVER HELD IN MEMORY');
    const store = read('services/inductionVideo/mediaStorage.ts');
    chk('storage can stream to and from a file',
      /export async function downloadMediaToFile/.test(store) &&
      /export async function uploadMediaFromFile/.test(store));
    chk('the transcode uses those, not the buffer helpers',
      /downloadMediaToFile\(rev\.sourceBlobPath!, destination\)/.test(svc) &&
      /uploadMediaFromFile\(path, outputPath, 'video\/mp4'\)/.test(svc),
      'a 300 MB source and its output were both full Buffers on a 1.75 GB instance');
    chk('  and the normaliser no longer returns the bytes',
      !/output: Buffer;/.test(read('services/inductionVideo/libraryNormaliser.ts')),
      'returning a Buffer is what forced the caller to hold one');
    chk('cleanup still happens even though the caller sees the file',
      /consume\(\{ outputPath: out, durationMs \}\)/.test(
        read('services/inductionVideo/libraryNormaliser.ts')) &&
      /finally \{\s*await rm\(work/.test(read('services/inductionVideo/libraryNormaliser.ts')),
      'a temp dir holding a copy of a video must not outlive the job');
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
