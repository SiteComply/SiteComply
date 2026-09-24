export {};
/**
 * Phase 3 end to end, against the local database: narrate → render → publish →
 * an operative watches it → the record.
 *
 * REAL SPEECH AND A REAL ENCODER when they are configured (SPEECH_KEY and
 * FFMPEG_PATH), because the point of this script is to prove the whole chain
 * produces a file a phone can play and a record a hearing would accept. It
 * cleans up every row and blob it creates.
 *
 * Run: SPEECH_KEY=… SPEECH_REGION=uksouth FFMPEG_PATH=… npx tsx scripts/inductionvideo_render_e2e.ts
 */
const { prisma } = require('../lib/prisma');
const narration = require('../services/inductionVideo/narrationService');
const svc = require('../services/inductionVideo/inductionVideoService');
const renderSvc = require('../services/inductionVideo/renderService');
const ops = require('../services/inductionVideo/operativeVideoService');
const retention = require('../services/inductionVideo/retentionService');
const storage = require('../services/inductionVideo/mediaStorage');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const SCENES = [
  ['WELCOME', 'Welcome to this project', 'Welcome to the site. Report to the site office before you start work.', true],
  ['EMERGENCY_PROCEDURES', 'If something goes wrong', 'Stop work and make your equipment safe. Go to the assembly point.', true],
  ['FIRE_MUSTER_POINT', 'Where to go', 'The assembly point is the rear car park, by the gate.', true],
] as const;

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  const worker = await prisma.worker.findFirst({ select: { id: true, fullName: true } });
  if (!site || !worker) { console.log('  needs an active site and a worker in the local database'); process.exit(1); }

  const director = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [site.id] };
  const engineer = { id: 'u2', name: 'Eve Engineer', role: 'PROJECT_MANAGER', siteIds: [site.id] };
  let videoId = '';
  const blobs: string[] = [];

  try {
    const version =
      ((await prisma.inductionVideo.findFirst({ where: { jobSiteId: site.id }, orderBy: { version: 'desc' }, select: { version: true } }))?.version ?? 0) + 1;
    const created = await prisma.inductionVideo.create({
      data: {
        jobSiteId: site.id, version, status: 'SCRIPT_READY',
        generatedAt: new Date(), generatedByName: 'e2e',
        scenes: { create: SCENES.map(([sceneType, heading, text, required], i) => ({
          sceneType, order: i, heading, narration: text, required, visualTemplate: 'TEXT_CARD' })) },
      },
      select: { id: true },
    });
    videoId = created.id;

    console.log('\n[1] Narrate, then render');
    await svc.approveScript(director, videoId);
    await narration.requestNarration(director, videoId);
    await narration.runQueuedNarrationJobs(1);
    const narrated = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true, narrationHash: true } });
    chk('the version is narrated', narrated.status === 'NARRATION_READY', narrated.status);

    const tooEarly = await renderSvc.requestRender(director, 'no-such-video');
    chk('an unknown version cannot be rendered', tooEarly.ok === false);

    const req = await renderSvc.requestRender(director, videoId);
    chk('a narrated version can be rendered', req.ok === true, req.ok ? '' : req.error);
    const queued = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true } });
    chk('  and is marked as rendering', queued.status === 'VIDEO_GENERATING', queued.status);

    const t0 = Date.now();
    const ran = await renderSvc.runQueuedRenderJobs(1);
    chk('the render job runs', ran === 1, `${Math.round((Date.now() - t0) / 1000)}s`);

    const rendered = await prisma.inductionVideo.findUnique({ where: { id: videoId } });
    chk('  producing a video ready for review', rendered.status === 'VIDEO_READY', rendered.status);
    chk('  with a file, a length and an engine recorded',
      Boolean(rendered.videoBlobPath) && rendered.videoDurationMs > 0 && Boolean(rendered.renderEngine),
      `${rendered.videoDurationMs}ms · ${(rendered.videoSizeBytes / 1048576).toFixed(2)}MB · ${rendered.renderEngine}`);
    if (rendered.videoBlobPath) blobs.push(rendered.videoBlobPath);

    const stored = await storage.readMedia(rendered.videoBlobPath, { offset: 0, count: 12 });
    chk('  the MP4 really is in the container, and is an MP4',
      stored !== null && stored.bytes.subarray(4, 8).toString('ascii') === 'ftyp',
      stored ? stored.bytes.subarray(4, 12).toString('ascii') : 'missing');
    chk('  the spend is recorded',
      (await prisma.aiUsageEvent.count({ where: { videoId, purpose: 'render' } })) === 1);

    console.log('\n[2] Publishing is a decision, and only theirs to take');
    const pmPublish = await renderSvc.publishVideo(engineer, videoId);
    chk('a Project Manager may NOT publish', pmPublish.ok === false, pmPublish.ok ? '' : pmPublish.error);

    // Make the render stale by editing the script underneath it.
    const scene = await prisma.inductionVideoScene.findFirst({ where: { videoId }, orderBy: { order: 'asc' } });
    await prisma.inductionVideo.update({ where: { id: videoId }, data: { narrationHash: 'something-else' } });
    const stalePublish = await renderSvc.publishVideo(director, videoId);
    chk('a STALE render cannot be published', stalePublish.ok === false, stalePublish.ok ? '' : stalePublish.error);
    await prisma.inductionVideo.update({ where: { id: videoId }, data: { narrationHash: narrated.narrationHash } });

    const published = await renderSvc.publishVideo(director, videoId);
    chk('a Director publishes it', published.ok === true, published.ok ? '' : published.error);
    const live = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true, publishedAt: true, publishedByName: true } });
    chk('  and the version records who and when',
      live.status === 'PUBLISHED' && live.publishedAt !== null && live.publishedByName === 'Dee Director');

    console.log('\n[3] The operative');
    const forWorker = await ops.videoForOperative(worker.id, site.id);
    chk('the operative is offered the published version',
      forWorker !== null && forWorker.videoId === videoId, forWorker?.videoId);
    chk('  with its length and captions', forWorker.durationMs > 0 && forWorker.hasCaptions === true);
    chk('  and it is optional until the site says otherwise', forWorker.required === false);

    const half = Math.round(forWorker.durationMs / 2);
    const p1 = await ops.recordProgress(worker, site.id, videoId, half);
    chk('watching half is recorded, and is not completion',
      p1.furthestMs === half && p1.completed === false, `${p1.furthestMs}ms`);
    const p2 = await ops.recordProgress(worker, site.id, videoId, 1_000);
    chk('  scrubbing back does NOT reduce the record', p2.furthestMs === half, `${p2.furthestMs}ms`);
    const p3 = await ops.recordProgress(worker, site.id, videoId, forWorker.durationMs + 60_000);
    chk('  and a client cannot claim more than the video holds',
      p3.furthestMs <= forWorker.durationMs, `${p3.furthestMs} of ${forWorker.durationMs}`);
    chk('  reaching the end completes it', p3.completed === true);

    await prisma.siteInductionConfig.upsert({
      where: { jobSiteId: site.id },
      create: { jobSiteId: site.id, inductionVideoRequired: true },
      update: { inductionVideoRequired: true },
    });
    const gate = await ops.videoGateSatisfied(worker.id, site.id);
    chk('the gate is satisfied for an operative who watched it', gate.satisfied === true);

    const other = await prisma.worker.findFirst({ where: { id: { not: worker.id } }, select: { id: true, fullName: true } });
    if (other) {
      const otherGate = await ops.videoGateSatisfied(other.id, site.id);
      chk('  and NOT for one who has not', otherGate.satisfied === false, otherGate.reason);
    }

    const views = await ops.viewsForVideo(videoId);
    chk('the manager can see who watched it',
      views.length === 1 && views[0].completedAt !== null && views[0].workerName === worker.fullName);

    console.log('\n[4] Withdrawing, and what retention may never remove');
    const withdrawn = await renderSvc.withdrawVideo(director, videoId, 'The assembly point has moved.');
    chk('a published video can be withdrawn with a reason', withdrawn.ok === true, withdrawn.ok ? '' : withdrawn.error);
    chk('  the operative is no longer offered it',
      (await ops.videoForOperative(worker.id, site.id)) === null);
    chk('  but the file and the watching record are untouched',
      (await storage.readMedia((await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { videoBlobPath: true } })).videoBlobPath, { offset: 0, count: 4 })) !== null &&
      (await prisma.inductionVideoView.count({ where: { videoId } })) === 1);

    await prisma.inductionVideo.update({
      where: { id: videoId },
      data: { supersededAt: new Date('2020-01-01'), publishedAt: null, status: 'VIDEO_READY' },
    });
    const sweptWatched = await retention.sweepUnpublishedRenders({ days: 1 });
    chk('retention will NOT remove a video somebody watched, however old',
      sweptWatched.removed === 0, JSON.stringify(sweptWatched));

    await prisma.inductionVideoView.deleteMany({ where: { videoId } });
    const dry = await retention.sweepUnpublishedRenders({ days: 1, dryRun: true });
    chk('  a dry run reports without deleting', dry.considered === 1 && dry.removed === 1 && dry.dryRun === true);
    const swept = await retention.sweepUnpublishedRenders({ days: 1 });
    chk('  an unwatched, never-published render is removed', swept.removed === 1, JSON.stringify(swept));
    const after = await prisma.inductionVideo.findUnique({
      where: { id: videoId },
      select: { videoBlobPath: true, transcriptBlobPath: true, captionsBlobPath: true, events: { where: { action: 'RENDER_REMOVED' } } },
    });
    chk('  the MP4 reference is cleared, the transcript and captions are kept',
      after.videoBlobPath === null && Boolean(after.transcriptBlobPath) && Boolean(after.captionsBlobPath));
    chk('  and the removal is on the version’s history', after.events.length === 1);
  } catch (e: any) {
    console.log(`  ERROR ${e.message}`);
    fails++;
  } finally {
    if (videoId) {
      const v = await prisma.inductionVideo.findUnique({
        where: { id: videoId },
        select: { videoBlobPath: true, captionsBlobPath: true, transcriptBlobPath: true, scenes: { select: { audioBlobPath: true } } },
      });
      for (const p of [v?.videoBlobPath, v?.captionsBlobPath, v?.transcriptBlobPath,
                       ...(v?.scenes ?? []).map((s: any) => s.audioBlobPath), ...blobs]) {
        if (p) await storage.deleteMedia(p);
      }
      await prisma.aiUsageEvent.deleteMany({ where: { videoId } });
      await prisma.inductionVideo.delete({ where: { id: videoId } }).catch(() => {});
    }
    await prisma.siteInductionConfig.updateMany({ data: { inductionVideoRequired: false } });
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
