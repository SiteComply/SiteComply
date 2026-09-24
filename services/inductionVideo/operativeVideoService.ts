import { prisma } from '@/lib/prisma';
import { publishedVideoForSite } from '@/services/inductionVideo/renderService';

/**
 * The operative's side of an induction video: what they are shown, and the
 * record that they watched it.
 *
 * ── THE RECORD IS THE POINT ───────────────────────────────────────────────
 *
 * A video nobody can prove was watched is a training aid. The row written here
 * names the person, the VERSION they saw, how far they got and whether they
 * finished - which is what makes an induction defensible months later, when the
 * site has moved on and the video is on its fourth version.
 *
 * ── PROGRESS ONLY EVER GOES FORWARD ───────────────────────────────────────
 *
 * `furthestMs` is the furthest point REACHED. An operative who scrubs back to
 * hear the assembly point again must not reduce what the record says they saw,
 * and an operative who drags the scrubber forward does not gain anything either:
 * the client reports its position, and this only ever raises a high-water mark.
 *
 * ── COMPLETION IS DECIDED HERE, NOT BY THE PLAYER ─────────────────────────
 *
 * The browser says where it has got to; the server decides whether that counts.
 * A player that claimed completion directly would be one edited fetch away from
 * a false induction record.
 */

/** Watched to within this of the end: the closing seconds are not worth failing on. */
const COMPLETION_TOLERANCE_MS = 3_000;
/** Below this proportion nothing counts as watched, whatever the tolerance says. */
const COMPLETION_FRACTION = 0.95;

export interface OperativeVideo {
  videoId: string;
  version: number;
  durationMs: number;
  sizeBytes: number | null;
  hasCaptions: boolean;
  /** The site's decision: must this be watched before the induction completes? */
  required: boolean;
  /** This operative's own progress, if they have started. */
  furthestMs: number;
  completed: boolean;
}

/**
 * The published video for a site, with this operative's progress on it.
 *
 * Returns null when the project has no published video - which is the normal
 * case for a site that has not adopted them, and the reason the induction must
 * work exactly as before when this is absent.
 */
export async function videoForOperative(
  workerId: string,
  siteId: string,
): Promise<OperativeVideo | null> {
  const video = await publishedVideoForSite(siteId);
  if (!video || !video.videoDurationMs) return null;

  const [config, view] = await Promise.all([
    prisma.siteInductionConfig.findUnique({
      where: { jobSiteId: siteId },
      select: { inductionVideoRequired: true },
    }),
    prisma.inductionVideoView.findUnique({
      where: { videoId_workerId: { videoId: video.id, workerId } },
      select: { furthestMs: true, completedAt: true },
    }),
  ]);

  return {
    videoId: video.id,
    version: video.version,
    durationMs: video.videoDurationMs,
    sizeBytes: video.videoSizeBytes,
    hasCaptions: Boolean(video.captionsBlobPath),
    required: config?.inductionVideoRequired ?? false,
    furthestMs: view?.furthestMs ?? 0,
    completed: Boolean(view?.completedAt),
  };
}

/** Is this the video this operative is allowed to stream right now? */
export async function operativeMayWatch(
  siteId: string,
  videoId: string,
): Promise<{ blobPath: string; captionsBlobPath: string | null } | null> {
  const video = await publishedVideoForSite(siteId);
  if (!video || video.id !== videoId || !video.videoBlobPath) return null;
  return { blobPath: video.videoBlobPath, captionsBlobPath: video.captionsBlobPath };
}

export interface ProgressResult {
  furthestMs: number;
  completed: boolean;
}

/**
 * Record how far an operative has watched.
 *
 * Called as they watch, so it is written to be cheap and idempotent: one row per
 * operative per version, raised rather than appended.
 */
export async function recordProgress(
  worker: { id: string; fullName: string },
  siteId: string,
  videoId: string,
  positionMs: number,
  submissionId?: string | null,
): Promise<ProgressResult | null> {
  const allowed = await operativeMayWatch(siteId, videoId);
  if (!allowed) return null;

  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: { videoDurationMs: true },
  });
  const durationMs = video?.videoDurationMs ?? 0;
  // Clamped to the video's own length: a client cannot report having watched
  // more than there is.
  const position = Math.max(0, Math.min(Math.round(positionMs), durationMs || Math.round(positionMs)));

  const existing = await prisma.inductionVideoView.findUnique({
    where: { videoId_workerId: { videoId, workerId: worker.id } },
    select: { furthestMs: true, completedAt: true },
  });
  const furthestMs = Math.max(existing?.furthestMs ?? 0, position);
  const completed =
    Boolean(existing?.completedAt) || isComplete(furthestMs, durationMs);

  const row = await prisma.inductionVideoView.upsert({
    where: { videoId_workerId: { videoId, workerId: worker.id } },
    create: {
      videoId,
      workerId: worker.id,
      workerName: worker.fullName,
      jobSiteId: siteId,
      furthestMs,
      videoDurationMs: durationMs || null,
      submissionId: submissionId ?? null,
      completedAt: completed ? new Date() : null,
    },
    update: {
      furthestMs,
      videoDurationMs: durationMs || null,
      // Set once and never cleared: an induction that was completed stays
      // completed, whatever the player does afterwards.
      ...(completed && !existing?.completedAt ? { completedAt: new Date() } : {}),
      ...(submissionId ? { submissionId } : {}),
    },
    select: { furthestMs: true, completedAt: true },
  });

  return { furthestMs: row.furthestMs, completed: Boolean(row.completedAt) };
}

/** Watched far enough to count. */
export function isComplete(furthestMs: number, durationMs: number): boolean {
  if (durationMs <= 0) return false;
  if (furthestMs >= durationMs - COMPLETION_TOLERANCE_MS) return true;
  return furthestMs / durationMs >= COMPLETION_FRACTION;
}

/**
 * Has this operative watched what the site requires, if anything?
 *
 * The gate the induction asks before it completes. A site that does not require
 * the video, or has none published, is never blocked by this.
 */
export async function videoGateSatisfied(
  workerId: string,
  siteId: string,
): Promise<{ satisfied: boolean; reason?: string }> {
  const video = await videoForOperative(workerId, siteId);
  if (!video || !video.required) return { satisfied: true };
  if (video.completed) return { satisfied: true };
  return {
    satisfied: false,
    reason: 'Please watch the site induction video before finishing your induction.',
  };
}

/** Who has watched a version, for the manager's record. */
export async function viewsForVideo(videoId: string) {
  return prisma.inductionVideoView.findMany({
    where: { videoId },
    orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
    select: {
      id: true,
      workerName: true,
      startedAt: true,
      completedAt: true,
      furthestMs: true,
      videoDurationMs: true,
    },
  });
}
