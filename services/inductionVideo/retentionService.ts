import { InductionVideoStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteMedia } from '@/services/inductionVideo/mediaStorage';

/**
 * Keeping the media store from growing without limit, without ever destroying
 * evidence.
 *
 * ── WHAT IS EVIDENCE AND WHAT IS A BY-PRODUCT ─────────────────────────────
 *
 * A video an operative was inducted with is evidence. It does not matter that a
 * newer version exists, that the site has finished, or that the file is large:
 * if somebody was shown it, it is the record of what they were shown, and this
 * sweep will not touch it. The same goes for the transcript and the captions,
 * which are what an investigation actually reads, and which are kilobytes.
 *
 * A render of a version nobody published and nobody watched is a by-product. It
 * can be made again from the approved script and the stored narration at any
 * time, for the cost of the render, so keeping it forever buys nothing.
 *
 * ── SO THE RULE IS NARROW ON PURPOSE ──────────────────────────────────────
 *
 * Only the MP4, only on a version that is superseded, was never published, and
 * has no viewing records at all. Everything else stays. The narrow rule is worth
 * more than the disk it saves: it can be read in one breath and it cannot
 * quietly delete the thing somebody needs.
 *
 * ── AND IT IS OFF UNTIL SOMEBODY TURNS IT ON ──────────────────────────────
 *
 * INDUCTION_MEDIA_RETENTION_DAYS unset means no sweeping at all. A retention
 * policy is a business decision about records, not a default a developer picks.
 */

export interface SweepResult {
  considered: number;
  removed: number;
  bytesFreed: number;
  /** True when nothing was actually deleted. */
  dryRun: boolean;
}

export function retentionDays(): number | null {
  const raw = Number(process.env.INDUCTION_MEDIA_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
}

/**
 * Remove the MP4s of superseded, never-published, never-watched versions older
 * than the configured window.
 *
 * Returns what it did (or would do), so the caller can record it rather than
 * having files disappear with no trace.
 */
export async function sweepUnpublishedRenders(
  opts: { days?: number | null; dryRun?: boolean; now?: Date } = {},
): Promise<SweepResult> {
  const days = opts.days ?? retentionDays();
  const dryRun = opts.dryRun ?? false;
  if (!days) return { considered: 0, removed: 0, bytesFreed: 0, dryRun: true };

  const cutoff = new Date((opts.now ?? new Date()).getTime() - days * 24 * 60 * 60 * 1_000);

  const candidates = await prisma.inductionVideo.findMany({
    where: {
      videoBlobPath: { not: null },
      // Superseded, and long enough ago that a manager is not still looking at it.
      supersededAt: { not: null, lt: cutoff },
      // NEVER PUBLISHED. publishedAt is cleared by a withdrawal, so the status
      // is checked too: a version that was published and then withdrawn is still
      // one operatives may have been shown.
      publishedAt: null,
      status: { not: InductionVideoStatus.PUBLISHED },
      // NEVER WATCHED. One view row is enough to keep the file forever.
      views: { none: {} },
    },
    select: { id: true, videoBlobPath: true, videoSizeBytes: true, version: true, jobSiteId: true },
  });

  let removed = 0;
  let bytesFreed = 0;
  for (const video of candidates) {
    if (!video.videoBlobPath) continue;
    if (!dryRun) {
      await deleteMedia(video.videoBlobPath);
      await prisma.$transaction([
        prisma.inductionVideo.update({
          where: { id: video.id },
          data: { videoBlobPath: null, videoSizeBytes: null },
        }),
        prisma.inductionVideoEvent.create({
          data: {
            videoId: video.id,
            action: 'RENDER_REMOVED',
            actorName: 'SiteComply',
            detail:
              `The video file was removed after ${days} days: this version was ` +
              'superseded without being published and nobody watched it. The ' +
              'script, narration, subtitles and transcript are kept, and it can ' +
              'be rendered again.',
          },
        }),
      ]);
    }
    removed++;
    bytesFreed += video.videoSizeBytes ?? 0;
  }

  return { considered: candidates.length, removed, bytesFreed, dryRun };
}
