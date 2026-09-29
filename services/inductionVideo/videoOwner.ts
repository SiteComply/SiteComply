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

/**
 * WHERE THIS VERSION BELONGS — the page to go back to, and to land on after it is
 * deleted.
 *
 * Both tiers interpolated `video.jobSiteId` straight into a project path, which for
 * a company video is null: the breadcrumb read `/sites/null/induction-video`, and
 * deleting one sent you there. A company video's home is its Library asset, so that
 * is what this returns.
 *
 * Takes builders rather than a base path because the two tiers shape these URLs
 * differently (`/sites/<id>/induction-video` against `/projects/<id>`), and a helper
 * that only worked for one of them would leave the other interpolating a null again.
 * Both callers are server components turning this into a plain string, so nothing
 * crosses the server/client boundary.
 */
export function videoOwnerHref(
  v: { jobSiteId: string | null; libraryAssetId: string | null },
  hrefs: {
    forSite: (siteId: string) => string;
    forAsset: (assetId: string) => string;
    /** Neither is set: a row that should not exist, so go somewhere real. */
    whenNeither: string;
  },
): string {
  if (v.jobSiteId) return hrefs.forSite(v.jobSiteId);
  if (v.libraryAssetId) return hrefs.forAsset(v.libraryAssetId);
  return hrefs.whenNeither;
}
