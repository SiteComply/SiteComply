import { createHash } from 'crypto';
import {
  InductionVideoJobKind,
  InductionVideoJobStatus,
  InductionVideoStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';
import type { VideoActor } from '@/services/inductionVideo/videoActor';
import {
  type VideoResult,
} from '@/services/inductionVideo/inductionVideoService';
import {
  AUDIO_CONTENT_TYPE,
  estimateNarrationPence,
  requireSpeechSynthesiser,
  resolveSpeechSynthesiser,
  type SpeechSynthesiser,
} from '@/services/inductionVideo/speechSynthesiser';
import {
  captionsPath,
  mediaExists,
  readMedia,
  sceneAudioPath,
  transcriptPath,
  uploadMedia,
} from '@/services/inductionVideo/mediaStorage';
import { refuseIfOverBudget } from '@/services/inductionVideo/spendGuard';
import { kickInductionJobs } from '@/services/inductionVideo/jobKicker';
import {
  buildTranscript,
  buildVtt,
  formatRunningTime,
  type CaptionScene,
} from '@/services/inductionVideo/captions';

/**
 * Narration: the approved script, spoken.
 *
 * ── ONLY APPROVED WORDS ARE EVER SPOKEN ───────────────────────────────────
 *
 * Narration can only be requested for a script a Director or Site Manager has
 * approved, and editing a scene clears its audio. So no operative can be played
 * a sentence nobody signed off, and no version can hold audio that disagrees
 * with the text beside it. This is the property the whole phase is built to
 * keep - it is also why the paid step sits behind the approval rather than
 * beside it.
 *
 * ── THE WORK IS RESUMABLE, BECAUSE IT COSTS MONEY ─────────────────────────
 *
 * Each scene is synthesised, stored and recorded before the next one starts,
 * and a scene whose narration and voice are unchanged is reused rather than
 * bought again. A run that fails on scene nine keeps the eight it paid for; a
 * retry finishes the job for the price of the remainder.
 *
 * ── CAPTIONS ARE PART OF THE PRODUCT ──────────────────────────────────────
 *
 * The transcript and WebVTT track are written in the same run, from the same
 * durations. A version cannot reach NARRATION_READY with audio and no captions,
 * which is the only way to stop accessibility becoming a later phase that never
 * arrives.
 */

/** What the job needs of the outside world, so a test can supply its own. */
export interface NarrationPorts {
  synthesiser: SpeechSynthesiser;
  put(blobPath: string, data: Buffer, contentType: string): Promise<void>;
  exists(blobPath: string): Promise<boolean>;
  /** Reads a library segment's caption file back, to splice into the subtitles. */
  get(blobPath: string): Promise<Buffer | null>;
}

export function azureNarrationPorts(): NarrationPorts {
  return {
    synthesiser: requireSpeechSynthesiser(),
    put: uploadMedia,
    exists: mediaExists,
    get: async (blobPath: string) => (await readMedia(blobPath))?.bytes ?? null,
  };
}

/** The fingerprint of one scene's audio: these exact words, in this voice. */
export function sceneAudioHash(narration: string, voice: string): string {
  return createHash('sha256')
    .update(`${voice}\n${narration.trim().replace(/\s+/g, ' ')}`)
    .digest('hex');
}

/** The fingerprint of a whole narration, for spotting a set that has moved on. */
export function narrationSetHash(sceneHashes: string[]): string {
  return createHash('sha256').update(sceneHashes.join('|')).digest('hex');
}

/**
 * Queue the narration of an approved script.
 *
 * Nothing long-running happens here either: the scheduler calls the speech
 * service, exactly as it calls the model for the script.
 */
export async function requestNarration(
  actor: VideoActor,
  videoId: string,
): Promise<VideoResult<{ queued: true; scenes: number }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      jobSiteId: true,
      status: true,
      version: true,
      _count: { select: { scenes: true } },
    },
  });
  if (!video || !actor.maySite(video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  const synthesiser = resolveSpeechSynthesiser();
  if (!synthesiser) {
    return { ok: false, error: 'Narration is not configured on this deployment.' };
  }
  /*
   * APPROVED, OR ALREADY NARRATED. Re-requesting a narrated version is how a
   * manager picks up a corrected scene or a changed voice, and it is cheap: the
   * scenes that have not changed are reused.
   */
  const startable =
    video.status === InductionVideoStatus.SCRIPT_APPROVED ||
    video.status === InductionVideoStatus.NARRATION_READY;
  if (!startable) {
    return {
      ok: false,
      error:
        video.status === InductionVideoStatus.NARRATION_GENERATING
          ? 'Narration is already being generated for this version.'
          : 'Only an approved script can be narrated.',
    };
  }
  if (video._count.scenes === 0) return { ok: false, error: 'There is nothing to narrate.' };

  const inFlight = await prisma.inductionVideoJob.findFirst({
    where: {
      videoId,
      kind: InductionVideoJobKind.NARRATION,
      status: { in: [InductionVideoJobStatus.QUEUED, InductionVideoJobStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (inFlight) {
    return { ok: false, error: 'Narration is already being generated for this version.' };
  }

  /*
   * Priced on WHAT WOULD ACTUALLY BE BOUGHT: a re-narration that reuses eleven
   * of twelve scenes must not be refused as though it were a whole video.
   */
  const scenes = await prisma.inductionVideoScene.findMany({
    where: { videoId },
    select: {
      narration: true,
      audioHash: true,
      audioDurationMs: true,
      libraryRevisionId: true,
    },
  });
  const voice = synthesiser.voice;
  /*
   * FOOTAGE IS NOT BOUGHT: it is already recorded, and estimating speech for it
   * would refuse a whole narration for a budget it was never going to spend.
   */
  const toBuy = scenes.filter(
    (s) =>
      !s.libraryRevisionId &&
      (!s.audioDurationMs || s.audioHash !== sceneAudioHash(s.narration, voice)),
  );
  const overBudget = await refuseIfOverBudget(
    estimateNarrationForScenes(toBuy.map((s) => s.narration)).pence,
  );
  if (overBudget) return { ok: false, error: overBudget };

  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: { status: InductionVideoStatus.NARRATION_GENERATING },
    }),
    prisma.inductionVideoJob.create({
      data: {
        videoId,
        kind: InductionVideoJobKind.NARRATION,
        requestedByName: actor.name,
      },
    }),
    prisma.inductionVideoEvent.create({
      data: {
        videoId,
        action: 'NARRATION_REQUESTED',
        actorName: actor.name,
        detail: `Version ${video.version} · ${video._count.scenes} scenes`,
      },
    }),
  ]);
  kickInductionJobs();
  return { ok: true, value: { queued: true, scenes: video._count.scenes } };
}

/**
 * Run queued narration jobs. Called by the scheduler tick, never by a request.
 *
 * ONE AT A TIME BY DEFAULT. A video is a dozen sequential calls to a metered
 * service; draining two videos at once on a single B1 instance buys nothing and
 * doubles what an outage or a loop can spend before anybody looks.
 */
export async function runQueuedNarrationJobs(
  limit = 1,
  ports?: NarrationPorts,
): Promise<number> {
  const jobs = await prisma.inductionVideoJob.findMany({
    where: { kind: InductionVideoJobKind.NARRATION, status: InductionVideoJobStatus.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, videoId: true },
  });
  if (jobs.length === 0) return 0;

  // Resolved once, and only when there is work: a deployment with no speech
  // configured must not throw on every tick.
  const resolved = ports ?? azureNarrationPorts();

  let done = 0;
  for (const job of jobs) {
    const claimed = await prisma.inductionVideoJob.updateMany({
      where: { id: job.id, status: InductionVideoJobStatus.QUEUED },
      data: {
        status: InductionVideoJobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue; // another tick has it

    try {
      await narrateVideo(job.videoId, resolved);
      await prisma.inductionVideoJob.update({
        where: { id: job.id },
        data: { status: InductionVideoJobStatus.SUCCEEDED, finishedAt: new Date() },
      });
      done++;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Narration failed.';
      await prisma.inductionVideoJob.update({
        where: { id: job.id },
        data: {
          status: InductionVideoJobStatus.FAILED,
          error: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      /*
       * BACK TO APPROVED, NOT TO FAILED. The script is still approved - that is
       * a human decision and a speech outage does not undo it. Returning the
       * version to its last true state is also what makes the retry button
       * simply work; the failure itself is on the job row and in the history.
       */
      await prisma.inductionVideo.update({
        where: { id: job.videoId },
        data: {
          status: InductionVideoStatus.SCRIPT_APPROVED,
          /*
           * THE SET-LEVEL ARTEFACTS GO, the scenes' audio stays.
           *
           * Individual scenes are kept because they are paid for and the retry
           * reuses them. The captions, the transcript and the total running time
           * describe a COMPLETE set, and after a part-finished run they describe
           * one that no longer exists: a re-narration in a different voice leaves
           * scene one re-spoken and scene nine as it was, and yesterday's cue
           * timings would fit neither. Cleared, so nothing stale can be served
           * and the version cannot claim a running time it does not have.
           */
          narrationAt: null,
          narrationDurationMs: null,
          narrationHash: null,
          captionsBlobPath: null,
          transcriptBlobPath: null,
        },
      });
      await prisma.inductionVideoEvent.create({
        data: {
          videoId: job.videoId,
          action: 'NARRATION_FAILED',
          actorName: 'SiteComply',
          detail: message.slice(0, 300),
        },
      });
    }
  }
  return done;
}

/** One video's narration, scene by scene, then its captions. */
async function narrateVideo(videoId: string, ports: NarrationPorts): Promise<void> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    include: {
      jobSite: { select: { id: true, name: true } },
      scenes: { orderBy: { order: 'asc' } },
    },
  });
  if (!video) throw new Error('That version no longer exists.');
  if (video.status !== InductionVideoStatus.NARRATION_GENERATING) {
    throw new Error('That version is no longer waiting for narration.');
  }
  if (video.scenes.length === 0) throw new Error('There is nothing to narrate.');

  const voice = ports.synthesiser.voice;
  let charsBilled = 0;
  let reused = 0;
  let estimatedDurations = 0;
  const hashes: string[] = [];

  for (const scene of video.scenes) {
    /*
     * LIBRARY FOOTAGE IS NOT NARRATED. It arrives with its own soundtrack and its
     * own caption file; synthesising a voice over it would talk across whoever is
     * already speaking on the film. Its duration comes from the segment, so the
     * set-level total below stays right.
     */
    if (scene.libraryRevisionId) {
      hashes.push(`library:${scene.libraryRevisionId}`);
      continue;
    }
    const hash = sceneAudioHash(scene.narration, voice);
    hashes.push(hash);
    const path = sceneAudioPath(video.jobSiteId, video.id, scene.order, scene.sceneType);

    /*
     * REUSE ONLY WHEN THE AUDIO IS REALLY THERE. Matching hashes prove the
     * words have not changed; they say nothing about the blob still existing.
     * Both are checked, so a manually cleaned container heals on the next run
     * instead of producing a version that points at nothing.
     */
    if (
      scene.audioHash === hash &&
      scene.audioBlobPath === path &&
      scene.audioDurationMs &&
      (await ports.exists(path))
    ) {
      reused++;
      continue;
    }

    const spoken = await ports.synthesiser.synthesise(scene.narration);
    await ports.put(path, spoken.audio, spoken.contentType || AUDIO_CONTENT_TYPE);
    charsBilled += spoken.chars;
    if (spoken.durationEstimated) estimatedDurations++;

    // Written as each scene completes: the run is resumable only because this
    // is not batched to the end.
    await prisma.inductionVideoScene.update({
      where: { id: scene.id },
      data: {
        audioBlobPath: path,
        audioDurationMs: spoken.durationMs,
        audioHash: hash,
      },
    });
  }

  // Re-read: the durations written in the loop are what the captions are cut to.
  const narrated = await prisma.inductionVideoScene.findMany({
    where: { videoId },
    orderBy: { order: 'asc' },
    select: {
      heading: true,
      narration: true,
      audioDurationMs: true,
      libraryRevisionId: true,
      libraryCaptionsBlobPath: true,
      libraryDurationMs: true,
    },
  });
  /*
   * FOOTAGE CONTRIBUTES ITS OWN DURATION AND ITS OWN CUES. Its caption file is
   * fetched and spliced onto the finished video's clock; without this the subtitles
   * would simply stop for the length of every library segment, which is the reason
   * a caption file is required before an asset can be issued.
   */
  const captionScenes: CaptionScene[] = await Promise.all(
    narrated.map(async (s) => {
      if (s.libraryRevisionId) {
        const vtt = s.libraryCaptionsBlobPath
          ? await ports.get(s.libraryCaptionsBlobPath)
          : null;
        return {
          heading: s.heading,
          narration: '',
          durationMs: s.libraryDurationMs ?? 0,
          libraryVtt: vtt ? vtt.toString('utf8') : undefined,
        };
      }
      return {
        heading: s.heading,
        narration: s.narration,
        durationMs: s.audioDurationMs ?? 0,
      };
    }),
  );
  const missingAudio = captionScenes.filter((s) => s.durationMs === 0).length;
  if (missingAudio > 0) {
    throw new Error(`${missingAudio} scene(s) have no audio; narration is incomplete.`);
  }
  const totalMs = captionScenes.reduce((n, s) => n + s.durationMs, 0);

  const narratedOn = new Date();
  const vttPath = captionsPath(video.jobSiteId, video.id);
  const txtPath = transcriptPath(video.jobSiteId, video.id);
  await ports.put(vttPath, Buffer.from(buildVtt(captionScenes), 'utf8'), 'text/vtt; charset=utf-8');
  await ports.put(
    txtPath,
    Buffer.from(
      buildTranscript(
        {
          siteName: video.jobSite.name,
          version: video.version,
          narratedOn: formatDateTimeUK(narratedOn),
          voice,
          totalMs,
        },
        captionScenes,
      ),
      'utf8',
    ),
    'text/plain; charset=utf-8',
  );

  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: InductionVideoStatus.NARRATION_READY,
        voice,
        narrationAt: narratedOn,
        narrationDurationMs: totalMs,
        narrationHash: narrationSetHash(hashes),
        captionsBlobPath: vttPath,
        transcriptBlobPath: txtPath,
      },
    }),
    prisma.inductionVideoEvent.create({
      data: {
        videoId,
        action: 'NARRATION_GENERATED',
        actorName: 'SiteComply',
        detail: [
          `${captionScenes.length} scenes`,
          reused ? `${reused} reused` : null,
          formatRunningTime(totalMs),
          voice,
          estimatedDurations
            ? `${estimatedDurations} scene(s) could not be measured; length estimated`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      },
    }),
    /*
     * ONLY THE CHARACTERS ACTUALLY BOUGHT. A rerun that reuses eleven of twelve
     * scenes must show as costing one scene, or the usage figures would punish
     * a manager for correcting a typo.
     */
    prisma.aiUsageEvent.create({
      data: {
        jobSiteId: video.jobSiteId,
        videoId,
        purpose: 'narration',
        provider: ports.synthesiser.provider,
        model: voice,
        speechChars: charsBilled,
        estimatedPence: estimateNarrationPence(charsBilled),
      },
    }),
  ]);
}

/* ─────────────────── what the routes are allowed to hand out ───────────── */

/**
 * The blob behind a piece of a version's media, for a viewer who may have it.
 *
 * Every media route goes through one of these, so the access rule lives in one
 * place rather than being restated - correctly or otherwise - in three route
 * files. Returns null for "no", without saying which of the reasons it was.
 */
export async function sceneAudioForViewer(
  actor: VideoActor,
  videoId: string,
  sceneId: string,
): Promise<{ blobPath: string } | null> {
  const scene = await prisma.inductionVideoScene.findFirst({
    where: { id: sceneId, videoId },
    select: { audioBlobPath: true, video: { select: { jobSiteId: true } } },
  });
  if (!scene?.audioBlobPath) return null;
  if (!actor.maySite(scene.video.jobSiteId)) return null;
  return { blobPath: scene.audioBlobPath };
}

export async function captionsForViewer(
  actor: VideoActor,
  videoId: string,
): Promise<{ blobPath: string; fileName: string } | null> {
  return mediaFor(actor, videoId, 'captions');
}

export async function transcriptForViewer(
  actor: VideoActor,
  videoId: string,
): Promise<{ blobPath: string; fileName: string } | null> {
  return mediaFor(actor, videoId, 'transcript');
}

async function mediaFor(
  actor: VideoActor,
  videoId: string,
  kind: 'captions' | 'transcript',
): Promise<{ blobPath: string; fileName: string } | null> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      jobSiteId: true,
      version: true,
      captionsBlobPath: true,
      transcriptBlobPath: true,
      jobSite: { select: { name: true } },
    },
  });
  if (!video || !actor.maySite(video.jobSiteId)) return null;
  const blobPath = kind === 'captions' ? video.captionsBlobPath : video.transcriptBlobPath;
  if (!blobPath) return null;
  const safeSite = video.jobSite.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'Site';
  const ext = kind === 'captions' ? 'vtt' : 'txt';
  return {
    blobPath,
    fileName: `${safeSite} induction v${video.version} ${kind}.${ext}`,
  };
}

/** What a narration would cost before it is run. Shown beside the button. */
export function estimateNarrationForScenes(narrations: string[]): {
  chars: number;
  pence: number;
} {
  const chars = narrations.reduce(
    (n, t) => n + t.trim().replace(/\s+/g, ' ').length,
    0,
  );
  return { chars, pence: estimateNarrationPence(chars) };
}
