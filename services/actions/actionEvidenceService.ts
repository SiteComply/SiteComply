import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { AnnotationMeta } from '@/services/annotations/annotationUpload';
import { markSuperseded } from '@/services/annotations/supersededEvidence';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { getActionForViewer } from '@/services/actions/actionService';
import {
  MAX_DOCUMENT_BYTES,
  ACCEPTED_DOCUMENT_MIME_TYPES,
} from '@/services/documents/documentConstants';
import {
  uploadDocumentBlob,
  downloadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';

/**
 * Evidence (photos / documents) attached to an Action.
 *
 * Reuses the existing private Documents blob container (via blobStorage) under an
 * `actions/<actionId>/` prefix — the DB row stores only the pointer + metadata.
 * Every operation is site-scoped through the parent action (getActionForViewer /
 * a relation filter), so a user can never touch evidence for an action outside
 * their Assigned Sites. Role checks (view to download, edit to upload/delete)
 * live in the routes via `permits`; the site boundary is enforced here as
 * defence in depth.
 */

/** Validate an uploaded evidence file — photos and common document types, ≤20 MB. */
export function validateEvidenceFile(
  file: { size: number; type: string } | null,
): { ok: true } | { ok: false; error: string } {
  if (!file || file.size === 0)
    return { ok: false, error: 'Please choose a file to upload.' };
  if (file.size > MAX_DOCUMENT_BYTES)
    return { ok: false, error: 'That file is too large (max 20 MB).' };
  if (!ACCEPTED_DOCUMENT_MIME_TYPES.includes(file.type as never))
    return {
      ok: false,
      error:
        'That file type is not supported. Use a photo (JPEG, PNG, HEIC or WEBP), PDF, Word, Excel or text file.',
    };
  return { ok: true };
}

function buildEvidenceBlobPath(actionId: string, fileName: string): string {
  const safe = (fileName || 'evidence')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-80);
  return `actions/${actionId}/${randomUUID()}-${safe}`;
}

export interface EvidenceView {
  /** SC-017: true for the annotated copy of a photo. */
  annotated: boolean;
  /** SC-017: on the annotated copy, the id of the original it was made from. */
  originalEvidenceId: string | null;
  /**
   * SC-017 FOLLOW-UP: this row is the original of an annotated photo that is
   * still present, so the annotated copy is the evidence and this is the audit
   * copy. Derived per result set, never stored — see `supersededEvidence.ts`.
   */
  supersededOriginal: boolean;
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** True for image types — the UI shows a thumbnail; others show a file row. */
  isImage: boolean;
  uploadedByName: string | null;
  createdAt: string; // ISO
}

function toView(e: {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  annotated: boolean;
  originalEvidenceId: string | null;
  uploadedByName: string | null;
  createdAt: Date;
}): EvidenceView {
  return {
    annotated: e.annotated,
    originalEvidenceId: e.originalEvidenceId,
    // Filled in by markSuperseded once the whole result set is known — a single
    // row cannot answer "is something else pointing at me?".
    supersededOriginal: false,
    id: e.id,
    fileName: e.fileName,
    mimeType: e.mimeType,
    size: e.size,
    isImage: e.mimeType.startsWith('image/'),
    uploadedByName: e.uploadedByName,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Evidence for an action, newest first. Not site-scoped itself — callers must
 *  have resolved the action for the viewer first (page/route does). */
export async function listActionEvidence(
  actionId: string,
): Promise<EvidenceView[]> {
  const rows = await prisma.actionEvidence.findMany({
    where: { actionId },
    orderBy: { createdAt: 'desc' },
  });
  // Tagged across the action's whole set: superseding is a relationship between
  // two rows, so it can only be decided once both are in hand.
  return markSuperseded(rows.map(toView));
}

export async function addActionEvidence(
  viewer: PlatformViewer,
  actionId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string; size: number },
  annotation?: AnnotationMeta,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'not_found' }> {
  // Scope + existence: the action must be in the viewer's Assigned Sites.
  const action = await getActionForViewer(viewer, actionId);
  if (!action) return { ok: false, reason: 'not_found' };

  const blobPath = buildEvidenceBlobPath(actionId, file.fileName);
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  const created = await prisma.actionEvidence.create({
    data: {
      actionId,
      blobPath,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      uploadedByUserId: viewer.id,
      uploadedByName: viewer.name,
      // SC-017 — set only for the annotated copy; the original row is untouched.
      annotated: annotation?.annotated ?? false,
      originalEvidenceId: annotation?.originalEvidenceId ?? null,
      // Prisma's Json input type doesn't accept a typed interface directly;
      // the shape is validated by isAnnotationDocument before it gets here.
      annotationData: annotation?.annotationData
        ? (annotation.annotationData as unknown as Prisma.InputJsonValue)
        : undefined,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Resolve one evidence record for download — only if its action is in scope. */
export async function getActionEvidenceForViewer(
  viewer: PlatformViewer,
  actionId: string,
  evidenceId: string,
) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.actionEvidence.findFirst({
    where: {
      id: evidenceId,
      actionId,
      action: { jobSiteId: { in: viewer.siteIds } },
    },
  });
}

export async function deleteActionEvidence(
  viewer: PlatformViewer,
  actionId: string,
  evidenceId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const ev = await getActionEvidenceForViewer(viewer, actionId, evidenceId);
  if (!ev) return { ok: false, reason: 'not_found' };
  await deleteDocumentBlob(ev.blobPath);
  await prisma.actionEvidence.delete({ where: { id: ev.id } });
  return { ok: true };
}
