import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { VideoActor } from '@/services/inductionVideo/videoActor';
import {
  anyWorking,
  describeAnyWork,
  describeWork,
  isWorkingStatus,
} from '@/services/inductionVideo/videoProgress';

/**
 * "HAS ANYTHING CHANGED?" — THE CHEAPEST POSSIBLE ANSWER.
 *
 * ── WHY THIS EXISTS: THE PAGE CRASHED WHILE RENDERING ─────────────────────
 *
 * The version page polled by calling `router.refresh()` every three seconds, which
 * re-renders the WHOLE page on the server: getVideo with its scenes, jobs and
 * events, the views, the spend, the per-project module overrides, and a narration
 * estimate. During a render that is about forty of those.
 *
 * And the renderer runs IN THIS PROCESS. `kickInductionJobs` spawns ffmpeg on the
 * same single B1 instance that serves the page, and a real render measured 123
 * seconds. So forty heavy server renders were queued behind - and competing with -
 * ffmpeg on one CPU. In production on 2026-09-29 the streamed React payload was
 * truncated under that load and the client threw
 *
 *     TypeError: Error in input stream
 *
 * three times on `/platform/dashboard/induction-videos/<id>` (SC-E-00009), which
 * trips the error boundary and shows "we've hit an unexpected problem". The
 * automatic updating was what broke the page, and the manual refresh the panels
 * told people to do landed on the same overloaded instance.
 *
 * ── THE SHAPE OF THE FIX ──────────────────────────────────────────────────
 *
 * Poll THIS instead: two indexed reads and a hash, no events, no views, no spend,
 * no overrides, no estimate, nothing rendered. The client re-renders the page only
 * when the fingerprint actually changes - twice in a typical run, when the
 * narration lands and when the render does, instead of forty times for nothing.
 *
 * ── THE FINGERPRINT COVERS WHAT THE SCREEN SHOWS ──────────────────────────
 *
 * Not just the status. Narration is written a scene at a time and the panel shows
 * each scene's length as it arrives, so the per-scene audio is in the hash and that
 * progress appears by itself. Job rows are in it too, so a FAILED job surfaces
 * immediately rather than waiting for a status the failed job never writes.
 */

export interface VideoProgress {
  /** Is a job in flight right now? */
  working: boolean;
  /** What is happening, in the words the person is waiting on. */
  label: string | null;
  /**
   * Changes whenever anything the screen shows changes. Opaque on purpose: the
   * client compares it and never interprets it.
   */
  fingerprint: string;
}

const digest = (parts: unknown[]): string =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

/**
 * Progress for ONE version.
 *
 * Authority is the same question the page asked to render in the first place, so a
 * poll can never reveal a version its viewer could not already open. Returns null
 * for "not yours or not there" - the caller turns that into a 404, exactly as the
 * page's own loader does.
 */
export async function videoProgress(
  actor: VideoActor,
  videoId: string,
): Promise<VideoProgress | null> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      jobSiteId: true,
      status: true,
      updatedAt: true,
      narrationAt: true,
      narrationDurationMs: true,
      captionsBlobPath: true,
      transcriptBlobPath: true,
      renderedAt: true,
      videoBlobPath: true,
      videoDurationMs: true,
      publishedAt: true,
      supersededAt: true,
      // A scene at a time: this is what makes narration progress visible without
      // re-rendering anything.
      scenes: { select: { id: true, audioDurationMs: true }, orderBy: { order: 'asc' } },
      // So a failure shows the moment it is recorded.
      jobs: { select: { id: true, kind: true, status: true, error: true } },
    },
  });
  if (!video) return null;
  /*
   * THE SAME GUARD THE SERVICE USES, asked the same way: a company video has no
   * project, so company authority is the bar; a site video is a question about that
   * project. Writing a looser check here would make this endpoint a way to watch a
   * version you may not open.
   */
  const allowed = video.jobSiteId === null ? actor.canManage : actor.maySite(video.jobSiteId);
  if (!allowed) return null;

  return {
    working: isWorkingStatus(video.status),
    label: describeWork(video.status),
    fingerprint: digest([
      video.status,
      video.updatedAt.getTime(),
      video.narrationAt?.getTime() ?? '',
      video.narrationDurationMs ?? '',
      video.captionsBlobPath ?? '',
      video.transcriptBlobPath ?? '',
      video.renderedAt?.getTime() ?? '',
      video.videoBlobPath ?? '',
      video.videoDurationMs ?? '',
      video.publishedAt?.getTime() ?? '',
      video.supersededAt?.getTime() ?? '',
      video.scenes.map((s) => `${s.id}:${s.audioDurationMs ?? ''}`).join(','),
      video.jobs.map((j) => `${j.id}:${j.kind}:${j.status}:${j.error ? 'e' : ''}`).join(','),
    ]),
  };
}

/**
 * Progress across one project's versions, for a project-level screen.
 *
 * The same pattern and the same reason: that page lists every version with its
 * scene and view counts, so polling it by re-rendering was the same waste on a
 * bigger page.
 */
export async function siteProgress(
  actor: VideoActor,
  siteId: string,
): Promise<VideoProgress | null> {
  if (!actor.maySite(siteId)) return null;
  const versions = await prisma.inductionVideo.findMany({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      status: true,
      updatedAt: true,
      publishedAt: true,
      supersededAt: true,
      videoBlobPath: true,
    },
  });

  return {
    working: anyWorking(versions),
    label: describeAnyWork(versions),
    fingerprint: digest(
      versions.map((v) =>
        [
          v.id,
          v.version,
          v.status,
          v.updatedAt.getTime(),
          v.publishedAt?.getTime() ?? '',
          v.supersededAt?.getTime() ?? '',
          v.videoBlobPath ?? '',
        ].join(':'),
      ),
    ),
  };
}
