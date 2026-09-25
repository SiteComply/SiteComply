import { randomUUID } from 'crypto';
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  RestError,
} from '@azure/storage-blob';
import { requireEnv } from '@/lib/config';

/**
 * Where induction-video media lives.
 *
 * ── A PRIVATE CONTAINER, LIKE DOCUMENTS ───────────────────────────────────
 *
 * Narration, captions and (Phase 3) the rendered MP4 sit in a private container
 * and are only ever handed back through a route that has already checked the
 * viewer's role and their assigned sites. No public container, and no blob URL
 * in a page, a link or an email - the property the Documents module has had
 * since SC-009 and the reason a leaked URL is not a leaked file.
 *
 * A SEPARATE CONTAINER from documents, on the same account. Documents are
 * uploaded by people and retained under their own rules; this is machine-made
 * media tied to a video version, with its own lifecycle. One container holding
 * both would make either lifecycle policy wrong for half its contents.
 *
 * ── SHORT-LIVED SAS, ONLY FOR THE RENDERER ────────────────────────────────
 *
 * Phase 3's renderer is a cloud service: it must fetch the audio and images
 * itself, so something has to be reachable from outside. By the owner's
 * decision that is a SAS URL scoped to ONE blob, read-only, expiring in
 * minutes - not a public container, and not an account key handed to a vendor.
 * The TTL is capped here so no caller can quietly ask for a week.
 *
 * Requires:
 *   MEDIA_STORAGE_CONNECTION_STRING  the storage account (falls back to the
 *                                    documents account, which is where it lives
 *                                    today)
 *   MEDIA_STORAGE_CONTAINER          container name (default "induction-media")
 */

let container: ContainerClient | undefined;
let ensured = false;

function getContainer(): ContainerClient {
  if (!container) {
    const connection =
      process.env.MEDIA_STORAGE_CONNECTION_STRING ||
      requireEnv('DOCS_STORAGE_CONNECTION_STRING');
    container = BlobServiceClient.fromConnectionString(connection).getContainerClient(
      process.env.MEDIA_STORAGE_CONTAINER || 'induction-media',
    );
  }
  return container;
}

/**
 * Create the container on first write, PRIVATE.
 *
 * No `access` option is passed, which is what makes it private; naming the
 * default would invite a later edit to "blob" that nobody would read as making
 * every induction video public. Called once per process on the write path only:
 * a read of a container that does not exist is a 404, which is the truth.
 */
async function ensureContainer(): Promise<ContainerClient> {
  const c = getContainer();
  if (!ensured) {
    await c.createIfNotExists();
    ensured = true;
  }
  return c;
}

/* ───────────────────────────── paths ────────────────────────────────────── */

/**
 * The layout, which is deliberately predictable:
 *
 *   induction-video/<siteId>/<videoId>/audio/<order>-<sceneType>.mp3
 *   induction-video/<siteId>/<videoId>/captions.vtt
 *   induction-video/<siteId>/<videoId>/transcript.txt
 *
 * ONE PATH PER SCENE, not per synthesis. Re-narrating a scene overwrites its
 * audio rather than leaving a trail of orphans nobody will ever delete, and a
 * version's whole media set can be listed, copied or expired by its prefix.
 */
export function videoMediaPrefix(siteId: string, videoId: string): string {
  return `induction-video/${siteId}/${videoId}`;
}

export function sceneAudioPath(
  siteId: string,
  videoId: string,
  order: number,
  sceneType: string,
): string {
  const safeType = sceneType.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  const seq = String(order).padStart(2, '0');
  return `${videoMediaPrefix(siteId, videoId)}/audio/${seq}-${safeType}.mp3`;
}

export function captionsPath(siteId: string, videoId: string): string {
  return `${videoMediaPrefix(siteId, videoId)}/captions.vtt`;
}

export function transcriptPath(siteId: string, videoId: string): string {
  return `${videoMediaPrefix(siteId, videoId)}/transcript.txt`;
}

/** Phase 3 writes the render here; named now so both phases agree on it. */
export function renderPath(siteId: string, videoId: string, ext = 'mp4'): string {
  return `${videoMediaPrefix(siteId, videoId)}/video-${randomUUID()}.${ext}`;
}

/**
 * Where a library asset's files live.
 *
 * A PREFIX OF ITS OWN, deliberately away from `videoMediaPrefix`. Library footage
 * belongs to no video, and the retention sweep deletes the render blobs of
 * superseded, unpublished, never-watched VERSIONS. A master sitting under a
 * video's prefix would eventually be swept out from under every induction that
 * concatenates it.
 */
export function libraryPrefix(assetId: string, revisionId: string): string {
  return `library/${assetId}/${revisionId}`;
}

/** The upload exactly as it arrived, kept so it can be transcoded again. */
export function librarySourcePath(
  assetId: string,
  revisionId: string,
  fileName: string,
): string {
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : 'mp4';
  return `${libraryPrefix(assetId, revisionId)}/source.${ext.replace(/[^a-z0-9]/g, '')}`;
}

/** The transcoded segment, ready to be concatenated by stream copy. */
export function libraryNormalisedPath(assetId: string, revisionId: string): string {
  return `${libraryPrefix(assetId, revisionId)}/segment.mp4`;
}

export function libraryCaptionsPath(assetId: string, revisionId: string): string {
  return `${libraryPrefix(assetId, revisionId)}/captions.vtt`;
}

/* ───────────────────────────── writing ─────────────────────────────────── */

export async function uploadMedia(
  blobPath: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const c = await ensureContainer();
  await c.getBlockBlobClient(blobPath).uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      // Private media behind an authorising route: no shared cache may keep it.
      blobCacheControl: 'private, max-age=0, no-store',
    },
  });
}

/** Best-effort delete, for media whose scene has gone. */
export async function deleteMedia(blobPath: string): Promise<void> {
  try {
    await getContainer().getBlockBlobClient(blobPath).deleteIfExists();
  } catch {
    // Swallowed: an orphaned blob is not worth failing a user's action for.
  }
}

/* ───────────────────────────── reading ─────────────────────────────────── */

export interface MediaBytes {
  bytes: Buffer;
  contentType: string;
  /** The blob's full size, which a range read does not change. */
  totalLength: number;
}

/**
 * Read a blob, or a byte range of one.
 *
 * RANGE SUPPORT IS NOT OPTIONAL FOR MEDIA. A player asks for the last bytes of
 * a file to find its length, then for the range it wants to play; a route that
 * only ever returns the whole file makes seeking impossible and stops some
 * browsers playing at all. So the range travels all the way down to the blob
 * and only those bytes cross the wire - which also keeps a 40 MB render off the
 * App Service heap.
 *
 * Returns null when the blob is missing, so a version whose media has been
 * cleaned up reports "no longer available" rather than failing.
 */
export async function readMedia(
  blobPath: string,
  range?: { offset: number; count?: number },
): Promise<MediaBytes | null> {
  try {
    const blob = getContainer().getBlockBlobClient(blobPath);
    const props = await blob.getProperties();
    const totalLength = props.contentLength ?? 0;
    const contentType = props.contentType || 'application/octet-stream';

    if (!range) {
      return { bytes: await blob.downloadToBuffer(), contentType, totalLength };
    }
    const offset = Math.max(0, Math.min(range.offset, Math.max(0, totalLength - 1)));
    const count =
      range.count === undefined
        ? undefined
        : Math.max(1, Math.min(range.count, totalLength - offset));
    return {
      bytes: await blob.downloadToBuffer(offset, count),
      contentType,
      totalLength,
    };
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) return null;
    throw error;
  }
}

/** Size and type without reading the bytes — what a range response needs first. */
export async function mediaProperties(
  blobPath: string,
): Promise<{ contentType: string; totalLength: number } | null> {
  try {
    const props = await getContainer().getBlockBlobClient(blobPath).getProperties();
    return {
      contentType: props.contentType || 'application/octet-stream',
      totalLength: props.contentLength ?? 0,
    };
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) return null;
    throw error;
  }
}

/** Does this blob exist? Used to decide whether audio can be reused. */
export async function mediaExists(blobPath: string): Promise<boolean> {
  try {
    return await getContainer().getBlockBlobClient(blobPath).exists();
  } catch {
    return false;
  }
}

/* ──────────────────────────── SAS, capped ──────────────────────────────── */

/** Two hours is longer than any render; nothing needs more. */
export const MAX_SAS_MINUTES = 120;

/**
 * A read-only link to ONE blob, expiring shortly.
 *
 * For the Phase 3 renderer and nothing else: never put one of these in a page,
 * an email or an operative's player, because a link that carries its own
 * authority cannot be withdrawn before it expires. The clock starts two minutes
 * early so a small skew between this server and the storage service does not
 * produce a link that is somehow not yet valid.
 */
export function clampSasMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 1;
  return Math.max(1, Math.min(Math.round(minutes), MAX_SAS_MINUTES));
}

export async function mediaSasUrl(blobPath: string, minutes = 60): Promise<string> {
  const ttl = clampSasMinutes(minutes);
  const blob = getContainer().getBlockBlobClient(blobPath);
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(Date.now() - 2 * 60_000),
    expiresOn: new Date(Date.now() + ttl * 60_000),
  });
}

/**
 * A short-lived URL a browser may PUT one file to.
 *
 * ── WHY UPLOADS DO NOT PASS THROUGH THE APPLICATION ───────────────────────
 *
 * A library video is tens or hundreds of megabytes. Streaming that through a Next
 * route on a small shared instance means the request body in memory, a platform
 * body-size limit to argue with, and a failure mode - a timeout halfway - that the
 * person uploading can do nothing about. The browser writes straight to storage
 * instead, and the application only records where the bytes landed.
 *
 * WRITE ONLY, AND BRIEFLY. The permission is create-and-write on ONE blob path,
 * not on the container: a leaked URL can overwrite the blob it was issued for and
 * nothing else. The same clamp the read URLs use caps how long it lives.
 */
export async function mediaUploadUrl(blobPath: string, minutes = 30): Promise<string> {
  const ttl = clampSasMinutes(minutes);
  const c = await ensureContainer();
  const blob = c.getBlockBlobClient(blobPath);
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse('cw'),
    startsOn: new Date(Date.now() - 2 * 60_000),
    expiresOn: new Date(Date.now() + ttl * 60_000),
  });
}

/** True when media storage is configured at all. Read by the UI. */
export function mediaStorageConfigured(): boolean {
  return Boolean(
    process.env.MEDIA_STORAGE_CONNECTION_STRING || process.env.DOCS_STORAGE_CONNECTION_STRING,
  );
}
