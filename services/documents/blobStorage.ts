import { Readable } from 'node:stream';
import { randomUUID } from 'crypto';
import {
  BlobServiceClient,
  ContainerClient,
  RestError,
} from '@azure/storage-blob';
import { requireEnv } from '@/lib/config';

/**
 * Private Azure Blob storage for the Documents module.
 *
 * Files are stored in a private container (no public access); they are only ever
 * streamed back to the client through a download route AFTER the RBAC + Assigned
 * Sites checks pass — a blob URL is never exposed. The client is created lazily
 * on first use so the app boots without storage configured (e.g. local dev that
 * doesn't touch Documents).
 *
 * Requires:
 *   DOCS_STORAGE_CONNECTION_STRING — the storage account connection string
 *   DOCS_STORAGE_CONTAINER         — container name (defaults to "documents")
 */

let container: ContainerClient | undefined;

function getContainer(): ContainerClient {
  if (!container) {
    const client = BlobServiceClient.fromConnectionString(
      requireEnv('DOCS_STORAGE_CONNECTION_STRING'),
    );
    container = client.getContainerClient(
      process.env.DOCS_STORAGE_CONTAINER || 'documents',
    );
  }
  return container;
}

/** Build a collision-free blob key that keeps a site's documents grouped. */
export function buildBlobPath(jobSiteId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  return `${jobSiteId}/${randomUUID()}-${safe}`;
}

export async function uploadDocumentBlob(
  blobPath: string,
  data: Buffer,
  mimeType: string,
): Promise<void> {
  const blockBlob = getContainer().getBlockBlobClient(blobPath);
  await blockBlob.uploadData(data, {
    blobHTTPHeaders: { blobContentType: mimeType },
  });
}

/** Download a blob's bytes. Returns null if the blob is missing. */
export async function downloadDocumentBlob(
  blobPath: string,
): Promise<Buffer | null> {
  try {
    const blockBlob = getContainer().getBlockBlobClient(blobPath);
    return await blockBlob.downloadToBuffer();
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) return null;
    throw error;
  }
}

/** Best-effort delete (used to clean up after a failed DB write). */
export async function deleteDocumentBlob(blobPath: string): Promise<void> {
  try {
    await getContainer().getBlockBlobClient(blobPath).deleteIfExists();
  } catch {
    // Swallow — deletion is best-effort; an orphaned blob is not user-facing.
  }
}

/**
 * Stream a blob's bytes rather than buffering them.
 *
 * SC-024 Phase 2 builds a ZIP of every original document on a project. Reading
 * each file into memory first would put the whole archive through a 1.75 GB
 * App Service one Buffer at a time; streaming keeps only the current chunk.
 *
 * Returns null when the blob is missing, so a deleted file skips the archive
 * instead of failing the whole export.
 */
export async function openDocumentBlobStream(
  blobPath: string,
): Promise<NodeJS.ReadableStream | null> {
  try {
    const blockBlob = getContainer().getBlockBlobClient(blobPath);
    const res = await blockBlob.download();
    return res.readableStreamBody ?? null;
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) return null;
    throw error;
  }
}

/** Upload from a stream — used for the close-out archive. */
export async function uploadBlobStream(
  blobPath: string,
  stream: Readable,
  mimeType: string,
): Promise<void> {
  const blockBlob = getContainer().getBlockBlobClient(blobPath);
  // 4 MB buffers, 4 in flight: enough to keep the upload saturated without
  // holding more than ~16 MB of the archive in memory at once.
  await blockBlob.uploadStream(stream, 4 * 1024 * 1024, 4, {
    blobHTTPHeaders: { blobContentType: mimeType },
  });
}
