/**
 * What a library upload may be, shared by the browser and the server.
 *
 * ── WHY ITS OWN MODULE ────────────────────────────────────────────────────
 *
 * The editor needs these VALUES to refuse a file before it is uploaded, and the
 * transcode needs them to refuse one that got through. They therefore cannot live
 * in libraryAssetService: that imports Prisma, and a value import from a client
 * component pulls the whole client into the browser bundle. A type-only import is
 * erased and safe, a value import is not, and the type checker does not complain
 * about either - which is exactly how that mistake gets shipped.
 *
 * Nothing here may import anything that touches the database or the filesystem.
 */

/**
 * THE CEILING ON AN UPLOAD, and why there has to be one.
 *
 * There was none at all - documents cap at 20 MB and the site map at 20 MB, but a
 * library video was unbounded. The transcode streams the source out of storage and
 * the result back, on the same 1.75 GB instance that serves every request, so an
 * unbounded upload is an unbounded ask of a machine that is also serving the site.
 *
 * 300 MB is roughly eight minutes of 1080p at a sensible export bitrate, far
 * longer than any induction segment should be.
 */
export const MAX_LIBRARY_VIDEO_BYTES = Number(
  process.env.NEXT_PUBLIC_LIBRARY_MAX_VIDEO_BYTES ?? 300 * 1024 * 1024,
);

/** Longest segment worth putting in front of an operative at a site gate. */
export const MAX_LIBRARY_VIDEO_MS = Number(
  process.env.LIBRARY_MAX_VIDEO_MS ?? 10 * 60 * 1000,
);

/** "300 MB", not "314572800". The number is for a person, not a log. */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
