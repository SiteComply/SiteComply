import { randomUUID } from 'crypto';
import {
  uploadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';

/**
 * Storage for worker CSCS/ECS card images (SC-001).
 *
 * Reuses the Documents module's PRIVATE Azure Blob container — the image is a
 * personal document that must never be exposed via a public URL. Card images are
 * grouped under a "cscs-cards/<workerId>/" prefix and streamed only through
 * RBAC-checked routes, exactly like other documents.
 */

const PREFIX = 'cscs-cards';

/** Accepted image types for a card photo/upload. */
export const CARD_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Max card image size (8 MB) — comfortably covers a phone photo. */
export const CARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export function isAllowedCardImageType(mime: string): boolean {
  return (CARD_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[mime] ?? 'img';
}

/** Upload a card image and return its private blob path. */
export async function uploadCardImage(
  workerId: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const blobPath = `${PREFIX}/${workerId}/${randomUUID()}.${extensionFor(mimeType)}`;
  await uploadDocumentBlob(blobPath, data, mimeType);
  return blobPath;
}

/** Best-effort delete of a stored card image (used on GDPR erasure). */
export async function deleteCardImage(blobPath: string): Promise<void> {
  await deleteDocumentBlob(blobPath);
}
