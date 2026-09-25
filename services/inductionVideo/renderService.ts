import { createHash } from 'crypto';
import {
  InductionVideoJobKind,
  InductionVideoJobStatus,
  InductionVideoStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { VideoActor } from '@/services/inductionVideo/videoActor';
import {
  type VideoResult,
} from '@/services/inductionVideo/inductionVideoService';
import { canApproveInductionVideo } from '@/services/inductionVideo/inductionVideoPermissions';
import {
  deleteMedia,
  readMedia,
  renderPath,
  uploadMedia,
} from '@/services/inductionVideo/mediaStorage';
import {
  estimateRenderPence,
  type RenderRequest,
  type VideoRenderer,
} from '@/services/inductionVideo/videoRenderer';
import { FfmpegVideoRenderer, ffmpegBinary } from '@/services/inductionVideo/ffmpegRenderer';
import { refuseIfOverBudget } from '@/services/inductionVideo/spendGuard';
import { kickInductionJobs } from '@/services/inductionVideo/jobKicker';

/**
 * Rendering a narrated induction into one MP4, and publishing it.
 *
 * ── THE RENDER IS DERIVED, THE APPROVAL IS NOT ────────────────────────────
 *
 * A render can be thrown away and made again from the same approved script and
 * the same audio; it costs time and possibly money, but nothing is lost. An
 * approval cannot - it is a person's decision. So rendering never touches the
 * approval, a failed render leaves the version exactly as narrated, and a stale
 * render is simply replaced.
 *
 * ── PUBLISHING IS THE ONLY IRREVERSIBLE-FEELING STEP ──────────────────────
 *
 * Publishing is what puts a video in front of operatives, so it is the one act
 * that supersedes every earlier version for that project. It requires a video
 * that exists, that was rendered from the audio currently on the version, and a
 * Director or Site Manager to say so - the same people who approved the words.
 */

/** What the render must match: the narration it was made from. */
export function renderFingerprint(narrationHash: string | null, engine: string): string {
  return createHash('sha256').update(`${engine}\n${narrationHash ?? ''}`).digest('hex');
}

/**
 * The engine this deployment renders with, or null when it cannot render.
 *
 * SELF-HOSTED WHEN A BINARY IS NAMED. There is deliberately no silent default
 * to "find something on the PATH" in production: rendering is CPU this instance
 * also needs for serving requests, so it happens because someone configured it,
 * not because a package manager happened to leave ffmpeg somewhere.
 */
export function resolveVideoRenderer(): VideoRenderer | null {
  const bin = ffmpegBinary();
  return bin ? new FfmpegVideoRenderer(bin) : null;
}

export function renderingConfigured(): boolean {
  return resolveVideoRenderer() !== null;
}

/** Queue a render of a narrated version. The scheduler (or the nudge) runs it. */
export async function requestRender(
  actor: VideoActor,
  videoId: string,
): Promise<VideoResult<{ queued: true }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      jobSiteId: true,
      status: true,
      version: true,
      narrationHash: true,
      _count: { select: { scenes: true } },
    },
  });
  if (!video || !actor.maySite(video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  const renderer = resolveVideoRenderer();
  if (!renderer) {
    return { ok: false, error: 'Video rendering is not configured on this deployment.' };
  }
  if (
    video.status !== InductionVideoStatus.NARRATION_READY &&
    video.status !== InductionVideoStatus.VIDEO_READY
  ) {
    return {
      ok: false,
      error:
        video.status === InductionVideoStatus.VIDEO_GENERATING
          ? 'This version is already being rendered.'
          : 'Only a narrated version can be rendered.',
    };
  }
  if (video._count.scenes === 0) return { ok: false, error: 'There is nothing to render.' };

  const inFlight = await prisma.inductionVideoJob.findFirst({
    where: {
      videoId,
      kind: InductionVideoJobKind.RENDER,
      status: { in: [InductionVideoJobStatus.QUEUED, InductionVideoJobStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (inFlight) return { ok: false, error: 'This version is already being rendered.' };

  const scenes = await prisma.inductionVideoScene.aggregate({
    where: { videoId },
    // Footage costs render time too: its duration is part of the finished video
    // even though nothing was bought to speak it.
    _sum: { audioDurationMs: true, libraryDurationMs: true },
  });
  const overBudget = await refuseIfOverBudget(
    estimateRenderPence(
      (scenes._sum.audioDurationMs ?? 0) + (scenes._sum.libraryDurationMs ?? 0),
      renderer.pencePerMinute,
    ),
  );
  if (overBudget) return { ok: false, error: overBudget };

  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: { status: InductionVideoStatus.VIDEO_GENERATING },
    }),
    prisma.inductionVideoJob.create({
      data: {
        videoId,
        kind: InductionVideoJobKind.RENDER,
        requestedByName: actor.name,
      },
    }),
    prisma.inductionVideoEvent.create({
      data: {
        videoId,
        action: 'RENDER_REQUESTED',
        actorName: actor.name,
        detail: `Version ${video.version} · ${renderer.engine}`,
      },
    }),
  ]);
  kickInductionJobs();
  return { ok: true, value: { queued: true } };
}

/**
 * Run queued render jobs.
 *
 * ONE AT A TIME, ALWAYS. A render is the most expensive thing this platform
 * does with a CPU; two at once on one instance make both slow and the site with
 * them.
 */
export async function runQueuedRenderJobs(
  limit = 1,
  renderer?: VideoRenderer,
): Promise<number> {
  const jobs = await prisma.inductionVideoJob.findMany({
    where: { kind: InductionVideoJobKind.RENDER, status: InductionVideoJobStatus.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, videoId: true },
  });
  if (jobs.length === 0) return 0;

  const engine = renderer ?? resolveVideoRenderer();
  if (!engine) return 0; // nothing configured: leave the jobs for a host that can

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
    if (claimed.count === 0) continue;

    try {
      const detail = await renderVideo(job.videoId, engine);
      await prisma.inductionVideoJob.update({
        where: { id: job.id },
        data: { status: InductionVideoJobStatus.SUCCEEDED, finishedAt: new Date() },
      });
      await prisma.inductionVideoEvent.create({
        data: {
          videoId: job.videoId,
          action: 'VIDEO_RENDERED',
          actorName: 'SiteComply',
          detail,
        },
      });
      done++;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The render failed.';
      await prisma.inductionVideoJob.update({
        where: { id: job.id },
        data: {
          status: InductionVideoJobStatus.FAILED,
          error: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      /*
       * BACK TO NARRATED. The audio and the approval are untouched by a failed
       * render - only the derived file is missing - so the version returns to
       * the last state that is true and the button simply works again.
       */
      await prisma.inductionVideo.update({
        where: { id: job.videoId },
        data: { status: InductionVideoStatus.NARRATION_READY },
      });
      await prisma.inductionVideoEvent.create({
        data: {
          videoId: job.videoId,
          action: 'RENDER_FAILED',
          actorName: 'SiteComply',
          detail: message.slice(0, 300),
        },
      });
    }
  }
  return done;
}

async function renderVideo(videoId: string, renderer: VideoRenderer): Promise<string> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    include: {
      jobSite: { select: { id: true, name: true } },
      scenes: { orderBy: { order: 'asc' } },
    },
  });
  if (!video) throw new Error('That version no longer exists.');
  if (video.status !== InductionVideoStatus.VIDEO_GENERATING) {
    throw new Error('That version is no longer waiting to be rendered.');
  }

  const request: RenderRequest = { siteName: video.jobSite.name, version: video.version, scenes: [] };
  for (const scene of video.scenes) {
    /*
     * LIBRARY FOOTAGE: the segment IS the scene. It was transcoded to this
     * pipeline's spec when it was uploaded, so it is fetched and passed straight
     * through - there is no audio to look for and nothing to draw.
     *
     * The path is read off the SCENE, not looked up through the asset, so
     * re-issuing or retiring a library video cannot change what an
     * already-rendered induction contains.
     */
    if (scene.libraryRevisionId) {
      if (!scene.libraryBlobPath || !scene.libraryDurationMs) {
        throw new Error(
          `“${scene.heading}” is a library video that has not finished being prepared.`,
        );
      }
      const segment = await readMedia(scene.libraryBlobPath);
      if (!segment) {
        throw new Error(
          `The footage for “${scene.heading}” is missing from storage. Re-upload the library video.`,
        );
      }
      request.scenes.push({
        sceneType: scene.sceneType,
        heading: scene.heading,
        narration: scene.narration,
        segment: segment.bytes,
        durationMs: scene.libraryDurationMs,
      });
      continue;
    }
    if (!scene.audioBlobPath || !scene.audioDurationMs) {
      throw new Error(`“${scene.heading}” has no audio. Narrate the version before rendering it.`);
    }
    const audio = await readMedia(scene.audioBlobPath);
    if (!audio) {
      throw new Error(`The audio for “${scene.heading}” is missing. Narrate the version again.`);
    }
    request.scenes.push({
      sceneType: scene.sceneType,
      heading: scene.heading,
      narration: scene.narration,
      audio: audio.bytes,
      durationMs: scene.audioDurationMs,
    });
  }

  const output = await renderer.render(request);
  const path = renderPath(video.jobSiteId, video.id);
  await uploadMedia(path, output.mp4, 'video/mp4');

  /*
   * THE PREVIOUS RENDER IS REMOVED once the new one is stored. Renders are
   * derived and can be remade; keeping every attempt of every version would grow
   * storage without giving anybody anything they could not regenerate. The
   * PUBLISHED file of a superseded version is a different matter - that is
   * evidence, and it is only ever replaced by a newer render of the same
   * version, which by definition nobody has been inducted against.
   */
  const previous = video.videoBlobPath;

  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: InductionVideoStatus.VIDEO_READY,
        videoBlobPath: path,
        videoDurationMs: output.durationMs,
        videoSizeBytes: output.mp4.length,
        renderEngine: output.engine,
        renderedAt: new Date(),
        renderHash: renderFingerprint(video.narrationHash, output.engine),
      },
    }),
    prisma.aiUsageEvent.create({
      data: {
        jobSiteId: video.jobSiteId,
        videoId,
        purpose: 'render',
        provider: output.engine,
        renderSeconds: output.renderSeconds,
        estimatedPence: estimateRenderPence(output.durationMs, renderer.pencePerMinute),
      },
    }),
  ]);
  if (previous && previous !== path) await deleteMedia(previous);

  const mb = (output.mp4.length / 1_048_576).toFixed(1);
  const seconds = Math.round(output.durationMs / 1000);
  return `${seconds}s · ${mb} MB · ${output.engine} · rendered in ${output.renderSeconds}s`;
}

/** True when the MP4 was rendered from narration that has since changed. */
export function renderIsStale(video: {
  renderHash: string | null;
  narrationHash: string | null;
  renderEngine: string | null;
}): boolean {
  if (!video.renderHash || !video.renderEngine) return false;
  return video.renderHash !== renderFingerprint(video.narrationHash, video.renderEngine);
}

/**
 * Publish a rendered version: make it the one operatives are shown.
 *
 * Supersedes every other version for the project, which is what stops two
 * published inductions existing at once. Earlier versions keep their file and
 * their watching records - an operative inducted against version 2 must still be
 * able to be shown what version 2 said.
 */
export async function publishVideo(
  actor: VideoActor,
  videoId: string,
): Promise<VideoResult<{ published: true }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      jobSiteId: true,
      status: true,
      version: true,
      videoBlobPath: true,
      renderHash: true,
      renderEngine: true,
      narrationHash: true,
    },
  });
  if (!video || !actor.maySite(video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  if (!actor.canApprove) {
    return { ok: false, error: 'Only a Director or Site Manager may publish an induction video.' };
  }
  if (video.status !== InductionVideoStatus.VIDEO_READY || !video.videoBlobPath) {
    return { ok: false, error: 'Only a rendered version can be published.' };
  }
  if (renderIsStale(video)) {
    return {
      ok: false,
      error: 'The script or narration has changed since this video was rendered. Render it again first.',
    };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: InductionVideoStatus.PUBLISHED,
        publishedAt: now,
        publishedByName: actor.name,
          publishedByRealm: actor.realm,
        supersededAt: null,
      },
    }),
    // Everything else for this project becomes history, in one statement so two
    // versions can never both be current.
    prisma.inductionVideo.updateMany({
      where: { jobSiteId: video.jobSiteId, id: { not: videoId }, supersededAt: null },
      data: { supersededAt: now },
    }),
    prisma.inductionVideoEvent.create({
      data: {
        videoId,
        action: 'PUBLISHED',
        actorName: actor.name,
        detail: `Version ${video.version} is now the induction operatives see`,
      },
    }),
  ]);
  return { ok: true, value: { published: true } };
}

/**
 * Withdraw a published video.
 *
 * Not a delete: the version, its file and every watching record stay. It stops
 * being SHOWN, which is what a manager needs when a detail turns out to be wrong
 * and the corrected version is not ready yet. The site falls back to the written
 * briefing screens, which have been there all along.
 */
export async function withdrawVideo(
  actor: VideoActor,
  videoId: string,
  reason: string,
): Promise<VideoResult<{ withdrawn: true }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: { id: true, jobSiteId: true, status: true, version: true },
  });
  if (!video || !actor.maySite(video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  if (!actor.canApprove) {
    return { ok: false, error: 'Only a Director or Site Manager may withdraw an induction video.' };
  }
  if (video.status !== InductionVideoStatus.PUBLISHED) {
    return { ok: false, error: 'That version is not published.' };
  }
  const why = reason.trim();
  if (why.length < 5) return { ok: false, error: 'Please say why it is being withdrawn.' };

  await prisma.$transaction([
    prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: InductionVideoStatus.VIDEO_READY,
        publishedAt: null,
        publishedByName: null,
        publishedByAdminId: null,
        publishedByRealm: null,
      },
    }),
    prisma.inductionVideoEvent.create({
      data: {
        videoId,
        action: 'WITHDRAWN',
        actorName: actor.name,
        detail: why.slice(0, 300),
      },
    }),
  ]);
  return { ok: true, value: { withdrawn: true } };
}

/** The version operatives are currently shown for a project, if any. */
export async function publishedVideoForSite(siteId: string) {
  return prisma.inductionVideo.findFirst({
    where: {
      jobSiteId: siteId,
      status: InductionVideoStatus.PUBLISHED,
      videoBlobPath: { not: null },
    },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      videoBlobPath: true,
      videoDurationMs: true,
      videoSizeBytes: true,
      captionsBlobPath: true,
      publishedAt: true,
    },
  });
}
