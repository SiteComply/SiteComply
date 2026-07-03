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
