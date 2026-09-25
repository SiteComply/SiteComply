/**
 * WHO OWNS AN INDUCTION VIDEO — a project, or the company?
 *
 * `InductionVideo.jobSiteId` became optional when company videos arrived, and the
 * compiler then found every place that had assumed a site: thirty of them, across
 * media paths, guards, titles and audit lines. This module is the one answer each of
 * them now asks, rather than thirty separate `?? ''` fixes that would each be a
 * silent wrong-partition bug waiting to happen.
 *
 * ── STORAGE PATHS MUST NOT MOVE ───────────────────────────────────────────
 *
 * For a site video `mediaOwnerId` returns the jobSiteId, so every blob path is
 * byte-identical to what it was: existing audio, captions and renders stay exactly
 * where they are. A company video partitions under its Library asset instead.
 *
 * No Prisma import: the video page and the working surface are client components.
 */

export interface VideoOwnership {
  id: string;
  jobSiteId: string | null;
  libraryAssetId: string | null;
}

export function isCompanyVideo(v: { jobSiteId: string | null }): boolean {
  return v.jobSiteId === null;
}

/**
 * The storage partition for this video's media.
 *
 * Falls back to the video's own id rather than throwing: a render that lands in a
 * slightly odd prefix is recoverable, whereas a job that dies on a null leaves a
 * version stuck with no explanation. Nothing reads these paths by construction -
 * they are all stored on the row that needed them.
 */
export function mediaOwnerId(v: VideoOwnership): string {
  return v.jobSiteId ?? v.libraryAssetId ?? v.id;
}

/**
 * What to call this video in a heading, a caption footer or an audit line.
 *
 * A company video has no project, so it is named by the Library asset it belongs
 * to. The fallback is deliberately the company name rather than "Unknown": an
 * operative sees this on screen.
 */
export function videoDisplayName(v: {
  jobSite?: { name: string } | null;
  libraryAsset?: { title: string } | null;
}): string {
  return v.jobSite?.name ?? v.libraryAsset?.title ?? 'Company induction';
}
