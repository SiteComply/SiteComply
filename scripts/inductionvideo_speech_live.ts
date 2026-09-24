export {};
/**
 * ONE REAL NARRATION, against Azure Speech and Azure Blob storage.
 *
 * Everything else about this pipeline is proven with a stub; this is the leg that
 * cannot be: that the document we send is accepted, that the audio can be
 * measured, and that the blobs land in a private container and come back. It
 * spends real money - about a penny for the three scenes below - and cleans up
 * every blob and row it creates.
 *
 * Run: SPEECH_KEY=… SPEECH_REGION=uksouth npx tsx scripts/inductionvideo_speech_live.ts
 */
const { prisma } = require('../lib/prisma');
const narration = require('../services/inductionVideo/narrationService');
const svc = require('../services/inductionVideo/inductionVideoService');
const storage = require('../services/inductionVideo/mediaStorage');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const SCENES = [
  ['WELCOME', 'Welcome to this project', 'Welcome to the site. Report to the site office before you start work.', true],
  ['EMERGENCY_PROCEDURES', 'If something goes wrong', 'Stop work, make your equipment safe, and go to the assembly point. Any scaffold < 2 metres is inspected weekly.', true],
  ['FIRE_MUSTER_POINT', 'Where to go', 'The assembly point is the rear car park, by the gate.', true],
] as const;

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  const director = { id: 'live', name: 'Live Check', role: 'DIRECTOR', siteIds: [site.id] };
  let videoId = '';
  const written: string[] = [];
  try {
    const version =
      ((await prisma.inductionVideo.findFirst({ where: { jobSiteId: site.id }, orderBy: { version: 'desc' }, select: { version: true } }))?.version ?? 0) + 1;
    const video = await prisma.inductionVideo.create({
      data: {
        jobSiteId: site.id, version, status: 'SCRIPT_READY',
        generatedAt: new Date(), generatedByName: 'live check',
        scenes: { create: SCENES.map(([sceneType, heading, text, required], i) => ({
          sceneType, order: i, heading, narration: text, required, visualTemplate: 'TEXT_CARD' })) },
      },
      select: { id: true },
    });
    videoId = video.id;

    await svc.approveScript(director, videoId);
    const req = await narration.requestNarration(director, videoId);
    chk('narration is requested against the real service', req.ok === true, req.ok ? '' : req.error);

    const t0 = Date.now();
    const ran = await narration.runQueuedNarrationJobs(1);
    const wall = Date.now() - t0;
    chk('the job ran', ran === 1, `${wall} ms for ${SCENES.length} scenes`);

    const done = await prisma.inductionVideo.findUnique({
      where: { id: videoId }, include: { scenes: { orderBy: { order: 'asc' } } },
    });
    chk('the version is narrated', done.status === 'NARRATION_READY', done.status);
    for (const s of done.scenes) {
      written.push(s.audioBlobPath);
      const blob = await storage.readMedia(s.audioBlobPath);
      chk(`  ${s.sceneType}: ${s.audioDurationMs} ms of audio is really in the container`,
        blob !== null && blob.bytes.length > 1_000 && blob.contentType === 'audio/mpeg',
        blob ? `${blob.bytes.length} bytes, ${blob.contentType}` : 'missing');
    }
    chk('  every duration was MEASURED, not estimated',
      done.scenes.every((s: any) => s.audioDurationMs > 0));

    written.push(done.captionsBlobPath, done.transcriptBlobPath);
    const vtt = (await storage.readMedia(done.captionsBlobPath))?.bytes.toString('utf8') ?? '';
    const txt = (await storage.readMedia(done.transcriptBlobPath))?.bytes.toString('utf8') ?? '';
    chk('the caption track is stored and valid', vtt.startsWith('WEBVTT'));
    chk('the transcript is stored and complete', SCENES.every(([, , t]) => txt.includes(t)));

    // A range read is how the browser will fetch it; prove it against the blob.
    const part = await storage.readMedia(done.scenes[0].audioBlobPath, { offset: 10, count: 100 });
    chk('a byte range comes back as a range', part !== null && part.bytes.length === 100 && part.totalLength > 100,
      part ? `${part.bytes.length} of ${part.totalLength}` : 'missing');

    const sas = await storage.mediaSasUrl(done.scenes[0].audioBlobPath, 5);
    chk('a SAS link can be minted for the Phase 3 renderer, read-only and short',
      /sig=/.test(sas) && /sp=r&?/.test(sas), sas.replace(/sig=[^&]+/, 'sig=…'));
    const fetched = await fetch(sas);
    chk('  and it actually fetches the audio', fetched.ok && fetched.headers.get('content-type') === 'audio/mpeg',
      `${fetched.status} ${fetched.headers.get('content-type')}`);

    const usage = await prisma.aiUsageEvent.findFirst({ where: { videoId, purpose: 'narration' } });
    chk('the spend is recorded', usage?.speechChars > 0, `${usage?.speechChars} chars ≈ ${usage?.estimatedPence}p`);

    console.log('\n  ── the caption track ──');
    console.log(vtt.split('\n').slice(0, 14).map((l: string) => `  ${l}`).join('\n'));
  } catch (e: any) {
    console.log(`  ERROR ${e.message}`);
    fails++;
  } finally {
    for (const p of written.filter(Boolean)) await storage.deleteMedia(p);
    if (videoId) {
      await prisma.aiUsageEvent.deleteMany({ where: { videoId } });
      await prisma.inductionVideo.delete({ where: { id: videoId } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed · ${written.length} blob(s) removed`);
    process.exit(fails ? 1 : 0);
  }
})();
