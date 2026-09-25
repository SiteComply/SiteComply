export {};
/**
 * A REAL VIDEO FILE, ALL THE WAY THROUGH. Nothing in this pipeline had ever been
 * exercised with actual media before 2026-09-25 - every other check reads source
 * or mocks the encoder.
 *
 * Upload → transcode → issue → assign to a site → build the manifest → render →
 * inspect the finished MP4. Uses REAL Azure blob storage and the REAL vendored
 * ffmpeg; cleans up every blob and row it creates.
 *
 * Run: FFMPEG_PATH=$PWD/vendor/ffmpeg/ffmpeg npx tsx scripts/library_endtoend_proof.ts
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm, readFile, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const run = promisify(execFile);
const { prisma } = require('../lib/prisma');
const lib = require('../services/inductionVideo/libraryAssetService');
const store = require('../services/inductionVideo/mediaStorage');
const { buildSceneManifest } = require('../services/inductionVideo/sceneRules');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');

const BIN = process.env.FFMPEG_PATH || `${process.cwd()}/vendor/ffmpeg/ffmpeg`;
let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const probe = async (f: string) => {
  try { return (await run(BIN, ['-hide_banner', '-i', f])).stderr; }
  catch (e: unknown) { return String((e as { stderr?: string }).stderr ?? ''); }
};

const SLUG = 'E2E_COMPANY_INTRO';
const director = moduleActorFromPlatformViewer(
  { id: 'e2e', name: 'E2E Director', role: 'DIRECTOR', siteIds: [] } as never);

(async () => {
  const work = await mkdtemp(join(tmpdir(), 'e2e-lib-'));
  const created: string[] = [];
  let assetId = '';
  try {
    await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });

    console.log('\n1. A LANDSCAPE MP4 WITH SOUND, LIKE A SUPPLIER WOULD SEND');
    const src = join(work, 'company-intro.mp4');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=4',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', src]);
    const srcInfo = await probe(src);
    chk('the source is landscape 1920x1080 at 30fps', /1920x1080/.test(srcInfo) && /30 fps/.test(srcInfo));
    chk('  with stereo 48kHz audio', /48000 Hz, stereo/.test(srcInfo));
    chk('  and it is nothing like the pipeline spec', true,
      'portrait 1080x1920, 25fps, 44.1kHz is what it has to become');

    console.log('\n2. CREATE THE ASSET AND A REVISION');
    const a = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'Company introduction', placement: 'OPENING', mandatory: false,
    });
    chk('the asset is created', a.ok === true, a.error ?? '');
    assetId = a.value.assetId;
    const r = await lib.startRevision(director, assetId);
    chk('a revision is opened', r.ok === true, r.error ?? '');
    const revisionId = r.value.revisionId;

    console.log('\n3. UPLOAD IT TO REAL BLOB STORAGE, THE WAY THE BROWSER DOES');
    chk('media storage is configured', store.mediaStorageConfigured() === true);
    const srcPath = store.librarySourcePath(assetId, revisionId, 'company-intro.mp4');
    const sasUrl = await store.mediaUploadUrl(srcPath);
    chk('the server issues a scoped upload URL', sasUrl.includes(srcPath) && sasUrl.includes('sig='));
    // The browser PUTs straight to that URL. curl stands in for the browser.
    const put = await run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
      '-X', 'PUT', '-H', 'x-ms-blob-type: BlockBlob', '-H', 'content-type: video/mp4',
      '--data-binary', `@${src}`, '--max-time', '120', sasUrl]);
    chk('the PUT to the SAS URL succeeds', put.stdout.trim() === '201', `HTTP ${put.stdout.trim()}`);
    created.push(srcPath);

    console.log('\n4. CAPTIONS ARE REQUIRED, SO UPLOAD ONE');
    const vtt = join(work, 'captions.vtt');
    await writeFile(vtt,
      'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nWelcome to the company.\n\n' +
      '00:00:02.000 --> 00:00:04.000\nSafety is how we work.\n', 'utf8');
    const capPath = store.libraryCaptionsPath(assetId, revisionId);
    const capUrl = await store.mediaUploadUrl(capPath);
    const capPut = await run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
      '-X', 'PUT', '-H', 'x-ms-blob-type: BlockBlob', '-H', 'content-type: text/vtt',
      '--data-binary', `@${vtt}`, '--max-time', '60', capUrl]);
    chk('the caption file uploads', capPut.stdout.trim() === '201', `HTTP ${capPut.stdout.trim()}`);
    created.push(capPath);

    console.log('\n5. ATTACH BOTH, WHICH QUEUES THE TRANSCODE');
    const bytes = (await stat(src)).size;
    const at1 = await lib.attachUpload(director, revisionId,
      { kind: 'VIDEO', blobPath: srcPath, fileName: 'company-intro.mp4', bytes });
    chk('the video attaches', at1.ok === true, at1.error ?? '');
    chk('  and a transcode is queued', at1.ok && at1.value.queued === true);
    const at2 = await lib.attachUpload(director, revisionId,
      { kind: 'CAPTIONS', blobPath: capPath, fileName: 'captions.vtt' });
    chk('the captions attach', at2.ok === true, at2.error ?? '');
    const stored = await prisma.libraryAssetRevision.findUnique({ where: { id: revisionId } });
    chk('the recorded size came from storage', stored.sourceBytes === bytes, `${stored.sourceBytes} vs ${bytes}`);
    chk('it cannot be issued yet',
      lib.revisionReadiness(stored).ready === false,
      lib.revisionReadiness(stored).missing.join(', '));

    console.log('\n6. RUN THE TRANSCODE (the real ffmpeg, the real streaming path)');
    const t0 = Date.now();
    const ran = await lib.runQueuedNormaliseJobs(1);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    chk('one job ran', ran === 1, `${secs}s`);
    const prepped = await prisma.libraryAssetRevision.findUnique({ where: { id: revisionId } });
    chk('no error was recorded', !prepped.normaliseError, prepped.normaliseError ?? '');
    chk('a transcoded segment exists in storage', Boolean(prepped.normalisedBlobPath));
    if (prepped.normalisedBlobPath) created.push(prepped.normalisedBlobPath);
    chk('its duration was measured', prepped.durationMs > 3500 && prepped.durationMs < 4500,
      `${prepped.durationMs}ms`);
    chk('now it is ready to issue', lib.revisionReadiness(prepped).ready === true,
      lib.revisionReadiness(prepped).missing.join(', '));

    const segLocal = join(work, 'segment.mp4');
    const got = await store.downloadMediaToFile(prepped.normalisedBlobPath, segLocal);
    chk('the segment downloads', got === true);
    const segInfo = await probe(segLocal);
    chk('it is PORTRAIT 1080x1920', /1080x1920/.test(segInfo));
    chk('it is 25 fps', /25 fps/.test(segInfo));
    chk('it has exactly ONE audio stream', (segInfo.match(/Audio:/g) ?? []).length === 1,
      `${(segInfo.match(/Audio:/g) ?? []).length} found`);
    chk('  stereo at 44100 Hz', /44100 Hz, stereo/.test(segInfo));

    console.log('\n7. ISSUE IT');
    const iss = await lib.issueRevision(director, revisionId, 'First company introduction.');
    chk('a Director can issue it', iss.ok === true, iss.error ?? '');

    console.log('\n8. A SITE RESOLVES IT WITHOUT BEING TOLD TO');
    const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
    chk('there is a site to induct into', Boolean(site), site?.name ?? 'none');
    const resolved = await lib.resolveLibraryForSite(site.id);
    const mine = resolved.find((x: { slug: string }) => x.slug === SLUG);
    chk('the site picks up the issued asset by default', Boolean(mine));
    chk('  carrying the TRANSCODED path, not the upload',
      mine?.blobPath === prepped.normalisedBlobPath, mine?.blobPath ?? '');
    chk('  and its captions', mine?.captionsBlobPath === capPath);

    console.log('\n9. THE MANIFEST PUTS IT IN THE INDUCTION');
    const manifest = buildSceneManifest({
      siteId: site.id, siteName: site.name, address: 'A', jobReference: 'R',
      inductionNotes: null, project: null, duty: null, siteManager: null,
      emergency: { fireAssemblyPoint: 'Rear gate', firstAiderName: 'Fay', firstAiderNumber: null,
        firstAiderLocation: 'Office', nearestHospital: null, emergencyNumber: null },
      keyPeople: [],
      info: { workingHours: null, welfareFacilities: null, siteHazards: null,
        emergencyProcedures: 'Stop work and go to the assembly point.', existingSiteRisks: null,
        temporaryWorks: null, trafficManagement: null, deliveryProcedures: null, accessEgress: null,
        environmentalControls: null, utilitiesIsolation: null, highRiskActivities: null,
        fireArrangements: null, hasSiteMap: false },
      incidentReporting: null, risks: [], permitTypes: [], ramsDocuments: [],
      modules: [], library: resolved, siteRules: ['Hard hat at all times.'], ppe: ['Hard hat'],
    });
    const libScene = manifest.scenes.find((s: { sceneType: string }) => s.sceneType === 'LIBRARY_SEGMENT');
    chk('the induction contains a library scene', Boolean(libScene));
    chk('  it is first, because the placement is OPENING',
      manifest.scenes[0].sceneType === 'LIBRARY_SEGMENT', manifest.scenes[0].sceneType);
    chk('  it carries the segment path, frozen onto the scene',
      libScene?.libraryBlobPath === prepped.normalisedBlobPath);
    chk('  and needs no narration', !libScene?.narration);

    console.log('\n10. RENDER THE INDUCTION AND LOOK AT THE RESULT');
    const { FfmpegVideoRenderer } = await import('../services/inductionVideo/ffmpegRenderer');
    const mp3 = join(work, 'n.mp3');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=3',
      '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
    const renderer = new FfmpegVideoRenderer(BIN, { timeoutMsPerScene: 180_000 });
    const out = await renderer.render({
      siteName: site.name, version: 1,
      scenes: [
        { sceneType: 'LIBRARY_SEGMENT', heading: 'Company introduction', narration: null,
          segment: await readFile(segLocal), durationMs: prepped.durationMs },
        { sceneType: 'WELCOME', heading: `Welcome to ${site.name}`,
          narration: 'Welcome to the site.', audio: await readFile(mp3), durationMs: 3000 },
      ],
    } as never);
    const final = join(work, 'induction.mp4');
    await writeFile(final, out.mp4);
    const fi = await probe(final);
    chk('an induction MP4 was produced', out.mp4.length > 10_000,
      `${(out.mp4.length / 1024).toFixed(0)} KB`);
    chk('it contains BOTH parts', /Duration: 00:00:0[67]/.test(fi),
      (fi.match(/Duration: [^,]+/) ?? [''])[0]);
    chk('one audio stream, stereo 44100',
      (fi.match(/Audio:/g) ?? []).length === 1 && /44100 Hz, stereo/.test(fi));
    chk('portrait 1080x1920 throughout', /1080x1920/.test(fi));
    const { stderr: dec } = await run(BIN, ['-hide_banner', '-nostdin', '-y', '-i', final,
      '-f', 'null', '-']).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? '') }));
    chk('it decodes cleanly end to end',
      !/Non-monotonic DTS/i.test(dec) && !/\b(invalid data|corrupt)\b/i.test(dec));
    // The footage really is in there: the first seconds must not be a flat colour.
    const frame = join(work, 'frame.png');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', '1',
      '-i', final, '-frames:v', '1', frame]);
    const frameBytes = (await stat(frame)).size;
    chk('a frame from the footage section is real imagery, not a generated card',
      frameBytes > 20_000, `${(frameBytes / 1024).toFixed(0)} KB PNG`);
  } finally {
    for (const p of created) { try { await store.deleteMedia(p); } catch { /* best effort */ } }
    if (assetId) await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
    await rm(work, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
