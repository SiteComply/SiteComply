export {};
/**
 * Phase 2 narration, end to end against the local database, with a stubbed
 * speech service and an in-memory container.
 *
 * WHAT THIS PROVES that the unit suite cannot: the state machine. A version
 * moves approved → narrating → narrated; a failure part-way keeps what it paid
 * for and returns the version to approved; a second run buys nothing it already
 * has; an edit silences exactly one scene and sends the script back for review.
 *
 * Run: npx tsx scripts/inductionvideo_speech_e2e.ts
 */
const { mp3DurationMs } = require('../services/inductionVideo/speechSynthesiser');
const { prisma } = require('../lib/prisma');
const narration = require('../services/inductionVideo/narrationService');
const svc = require('../services/inductionVideo/inductionVideoService');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

/** 24 ms a frame, so a scene's length is a known function of its text. */
function fakeMp3(frames: number): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    const f = Buffer.alloc(144);
    f[0] = 0xff; f[1] = 0xf3; f[2] = 0x64; f[3] = 0xc0;
    parts.push(f);
  }
  return Buffer.concat(parts);
}

const store = new Map<string, { data: Buffer; type: string }>();
const spoken: string[] = [];

/** The stub measures its own audio, exactly as the Azure implementation does. */
function makePorts(failOnCall?: number) {
  return {
    synthesiser: {
      provider: 'stub-speech',
      voice: 'en-GB-SoniaNeural',
      async synthesise(text: string) {
        spoken.push(text);
        if (failOnCall && spoken.length === failOnCall) {
          throw new Error('The speech service refused the request (503).');
        }
        const audio = fakeMp3(Math.max(1, Math.round(text.length / 2)));
        const measured = mp3DurationMs(audio);
        return {
          audio,
          contentType: 'audio/mpeg',
          durationMs: measured,
          durationEstimated: measured === null,
          chars: text.length,
          voice: 'en-GB-SoniaNeural',
        };
      },
    },
    put: async (p: string, data: Buffer, type: string) => { store.set(p, { data, type }); },
    exists: async (p: string) => store.has(p),
  };
}

const SCENES = [
  ['WELCOME', 'Welcome to this project', 'Welcome to the site. Report to the site office before you start work today.', true],
  ['EMERGENCY_PROCEDURES', 'If something goes wrong', 'Stop work, make your equipment safe, and go to the assembly point. Tell the site manager what has happened.', true],
  ['FIRE_MUSTER_POINT', 'Where to go', 'The assembly point is the rear car park, by the gate.', true],
  ['PPE', 'What to wear', 'Wear a hard hat, boots and a high-visibility vest at all times.', false],
] as const;

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!site) { console.log('  no active site in the local database'); process.exit(1); }
  const director = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [site.id] };
  const outsider = { id: 'u9', name: 'Otto Other', role: 'DIRECTOR', siteIds: ['some-other-site'] };
  let videoId = '';

  try {
    const nextVersion =
      ((await prisma.inductionVideo.findFirst({ where: { jobSiteId: site.id }, orderBy: { version: 'desc' }, select: { version: true } }))?.version ?? 0) + 1;
    const video = await prisma.inductionVideo.create({
      data: {
        jobSiteId: site.id,
        version: nextVersion,
        status: 'SCRIPT_READY',
        generatedAt: new Date(),
        generatedByName: 'e2e',
        scenes: {
          create: SCENES.map(([sceneType, heading, text, required], i) => ({
            sceneType, order: i, heading, narration: text, required, visualTemplate: 'TEXT_CARD',
          })),
        },
      },
      select: { id: true },
    });
    videoId = video.id;

    console.log('\n[1] Narration follows approval, and configuration');
    delete process.env.SPEECH_KEY;
    delete process.env.SPEECH_REGION;
    const unconfigured = await narration.requestNarration(director, videoId);
    chk('with no speech service configured, the request is refused clearly',
      unconfigured.ok === false && /not configured/.test(unconfigured.error), unconfigured.error);

    process.env.SPEECH_KEY = 'stub-key';
    process.env.SPEECH_REGION = 'northeurope';
    const tooEarly = await narration.requestNarration(director, videoId);
    chk('an unapproved script cannot be narrated',
      tooEarly.ok === false && /approved/.test(tooEarly.error), tooEarly.error);

    chk('a Director approves the script', (await svc.approveScript(director, videoId)).ok === true);
    const req = await narration.requestNarration(director, videoId);
    chk('  and narration can then be requested', req.ok === true, req.ok ? '' : req.error);
    const queued = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true, jobs: { select: { kind: true, status: true } } } });
    chk('  the version is NARRATION_GENERATING with one queued job',
      queued.status === 'NARRATION_GENERATING' &&
        queued.jobs.filter((j: any) => j.kind === 'NARRATION' && j.status === 'QUEUED').length === 1,
      queued.status);
    const second = await narration.requestNarration(director, videoId);
    chk('  a second request cannot double-spend', second.ok === false, second.error);

    console.log('\n[2] The run: audio, captions, transcript, cost');
    const ran = await narration.runQueuedNarrationJobs(1, makePorts());
    chk('the scheduler runs the narration job', ran === 1, `${ran} job(s)`);
    const done = await prisma.inductionVideo.findUnique({
      where: { id: videoId },
      include: { scenes: { orderBy: { order: 'asc' } }, events: true },
    });
    chk('the version is narrated', done.status === 'NARRATION_READY', done.status);
    chk('  every scene has audio, a measured length and a hash',
      done.scenes.every((s: any) => s.audioBlobPath && s.audioDurationMs > 0 && s.audioHash),
      done.scenes.map((s: any) => `${s.sceneType}:${s.audioDurationMs}ms`).join(' '));
    chk('  the total running time is the sum of the scenes',
      done.narrationDurationMs === done.scenes.reduce((n: number, s: any) => n + s.audioDurationMs, 0),
      `${done.narrationDurationMs}ms`);
    chk('  the voice is recorded', done.voice === 'en-GB-SoniaNeural', done.voice);
    chk('  every audio blob really exists in the container',
      done.scenes.every((s: any) => store.has(s.audioBlobPath)));
    chk('  captions and the transcript were written in the same run',
      Boolean(done.captionsBlobPath) && Boolean(done.transcriptBlobPath) &&
        store.has(done.captionsBlobPath) && store.has(done.transcriptBlobPath));

    const vtt = store.get(done.captionsBlobPath)!.data.toString('utf8');
    chk('  the caption file is valid WebVTT', vtt.startsWith('WEBVTT\n\n') && / --> /.test(vtt));
    const lastCueEnd = [...vtt.matchAll(/--> (\d\d):(\d\d):(\d\d)\.(\d\d\d)/g)]
      .map((m) => Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]))
      .pop();
    chk('  and its last cue ends with the audio, to the millisecond',
      lastCueEnd === done.narrationDurationMs, `${lastCueEnd} vs ${done.narrationDurationMs}`);
    const txt = store.get(done.transcriptBlobPath)!.data.toString('utf8');
    chk('  the transcript carries every scene in full',
      SCENES.every(([, , text]) => txt.includes(text)));
    chk('  and is labelled with the site and version',
      txt.includes(site.name) && txt.includes(`Version ${nextVersion}`));

    const usage = await prisma.aiUsageEvent.findMany({ where: { videoId, purpose: 'narration' } });
    chk('the spend is recorded once, in characters',
      usage.length === 1 && usage[0].speechChars === SCENES.reduce((n, [, , t]) => n + t.length, 0),
      `${usage[0]?.speechChars} chars`);
    chk('  with an estimated cost', usage[0].estimatedPence !== null);
    chk('the trail records the request and the result',
      ['NARRATION_REQUESTED', 'NARRATION_GENERATED'].every((a) => done.events.some((e: any) => e.action === a)),
      done.events.map((e: any) => e.action).join(' → '));

    console.log('\n[3] A second run buys nothing it already has');
    spoken.length = 0;
    chk('re-narrating a narrated version is allowed',
      (await narration.requestNarration(director, videoId)).ok === true);
    await narration.runQueuedNarrationJobs(1, makePorts());
    chk('  and the speech service is not called at all',
      spoken.length === 0, `${spoken.length} call(s)`);
    const reuse = await prisma.aiUsageEvent.findMany({ where: { videoId, purpose: 'narration' }, orderBy: { createdAt: 'asc' } });
    chk('  so the second run costs nothing',
      reuse.length === 2 && reuse[1].speechChars === 0, `${reuse[1]?.speechChars} chars`);

    console.log('\n[4] An edit silences exactly one scene');
    const ppe = done.scenes.find((s: any) => s.sceneType === 'PPE');
    const edit = await svc.editScene(director, ppe.id, 'Wear a hard hat, boots, gloves and a high-visibility vest at all times.');
    chk('a scene can be corrected', edit.ok === true, edit.ok ? '' : edit.error);
    const afterEdit = await prisma.inductionVideo.findUnique({
      where: { id: videoId },
      include: { scenes: { orderBy: { order: 'asc' } } },
    });
    chk('  its audio is cleared',
      afterEdit.scenes.find((s: any) => s.id === ppe.id).audioBlobPath === null);
    chk('  the other scenes keep theirs',
      afterEdit.scenes.filter((s: any) => s.id !== ppe.id).every((s: any) => s.audioBlobPath));
    chk('  the script returns to review, and the approval is withdrawn',
      afterEdit.status === 'SCRIPT_READY' && afterEdit.approvedAt === null, afterEdit.status);
    chk('  and the captions built from the old words are withdrawn too',
      afterEdit.captionsBlobPath === null && afterEdit.transcriptBlobPath === null);

    spoken.length = 0;
    await svc.approveScript(director, videoId);
    await narration.requestNarration(director, videoId);
    await narration.runQueuedNarrationJobs(1, makePorts());
    chk('re-narrating pays for the corrected scene only',
      spoken.length === 1 && spoken[0].includes('gloves'), `${spoken.length} call(s)`);
    const renarrated = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true, captionsBlobPath: true } });
    chk('  and the captions are rebuilt',
      renarrated.status === 'NARRATION_READY' && Boolean(renarrated.captionsBlobPath));

    console.log('\n[5] A failure keeps what it paid for');
    await prisma.inductionVideoScene.updateMany({
      where: { videoId },
      data: { audioBlobPath: null, audioDurationMs: null, audioHash: null },
    });
    store.clear();
    spoken.length = 0;
    await prisma.inductionVideo.update({ where: { id: videoId }, data: { status: 'SCRIPT_APPROVED', approvedAt: new Date(), approvedByName: 'Dee Director' } });
    await narration.requestNarration(director, videoId);
    await narration.runQueuedNarrationJobs(1, makePorts(3)); // the third scene fails
    const failed = await prisma.inductionVideo.findUnique({
      where: { id: videoId },
      include: { scenes: { orderBy: { order: 'asc' } }, jobs: { orderBy: { createdAt: 'desc' }, take: 1 }, events: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    chk('the job is marked failed with the reason',
      failed.jobs[0].status === 'FAILED' && /503/.test(failed.jobs[0].error), failed.jobs[0].error);
    chk('  the version returns to approved, not to a dead end',
      failed.status === 'SCRIPT_APPROVED', failed.status);
    chk('  the failure is in the history', failed.events[0].action === 'NARRATION_FAILED');
    chk('  the two scenes already spoken keep their audio',
      failed.scenes.filter((s: any) => s.audioBlobPath).length === 2,
      `${failed.scenes.filter((s: any) => s.audioBlobPath).length} kept`);
    chk('  and the version is NOT called narrated with scenes missing',
      failed.captionsBlobPath === null);

    spoken.length = 0;
    await narration.requestNarration(director, videoId);
    await narration.runQueuedNarrationJobs(1, makePorts());
    const recovered = await prisma.inductionVideo.findUnique({ where: { id: videoId }, select: { status: true, narrationDurationMs: true } });
    chk('a retry finishes the job, paying only for the remainder',
      spoken.length === 2, `${spoken.length} call(s)`);
    chk('  and the version is narrated in full',
      recovered.status === 'NARRATION_READY' && recovered.narrationDurationMs > 0, recovered.status);

    console.log('\n[6] Two ticks cannot run the same job twice');
    await prisma.inductionVideo.update({ where: { id: videoId }, data: { status: 'SCRIPT_APPROVED' } });
    await narration.requestNarration(director, videoId);
    const [a, b] = await Promise.all([
      narration.runQueuedNarrationJobs(1, makePorts()),
      narration.runQueuedNarrationJobs(1, makePorts()),
    ]);
    chk('only one of two concurrent ticks claims it', a + b === 1, `${a} + ${b}`);

    console.log('\n[7] Media is only handed to someone who may have it');
    const scene = await prisma.inductionVideoScene.findFirst({ where: { videoId, audioBlobPath: { not: null } }, select: { id: true } });
    chk('a manager on the project gets the audio path',
      (await narration.sceneAudioForViewer(director, videoId, scene.id)) !== null);
    chk('a manager on another project gets nothing',
      (await narration.sceneAudioForViewer(outsider, videoId, scene.id)) === null);
    chk('  and nor do they get the transcript',
      (await narration.transcriptForViewer(outsider, videoId)) === null);
    chk('a scene id from another version is refused',
      (await narration.sceneAudioForViewer(director, 'not-this-video', scene.id)) === null);
    const file = await narration.captionsForViewer(director, videoId);
    chk('the captions download is named for the site and version',
      file !== null && file.fileName.includes(`v${nextVersion}`), file?.fileName);
  } catch (e: any) {
    console.log(`  ERROR ${e.message}`);
    fails++;
  } finally {
    if (videoId) {
      await prisma.aiUsageEvent.deleteMany({ where: { videoId } });
      await prisma.inductionVideo.delete({ where: { id: videoId } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
