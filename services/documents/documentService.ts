import { DocumentCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isDocumentCategory,
  MAX_DOCUMENT_BYTES,
  ACCEPTED_DOCUMENT_MIME_TYPES,
} from '@/services/documents/documentConstants';
import {
  buildBlobPath,
  uploadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';

/**
 * Documents module service (Phase 1).
 *
 * All reads and writes are site-scoped: a document belongs to exactly one site,
 * and every query is constrained to the viewer's accessible `siteIds` so a user
 * can never see or touch a document for a site outside their scope. Role-based
 * permission checks (view/create/edit) live in the routes/pages via `permits`;
 * the site boundary is enforced here as defence in depth.
 */

const TITLE_MIN = 2;
const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;

export interface DocumentMetaInput {
  title?: string;
  description?: string;
  category?: string;
  jobSiteId?: string;
}

export interface ValidatedDocumentMeta {
  title: string;
  description: string | null;
  category: DocumentCategory;
  jobSiteId: string;
}

export type DocumentFieldErrors = Partial<
  Record<keyof DocumentMetaInput, string>
>;

/**
 * Validate document metadata against the viewer's scope. `jobSiteId` must be a
 * site the viewer can access, so a user cannot file a document to a site they
 * don't have.
 */
export function validateDocumentMeta(
  input: DocumentMetaInput,
  viewer: PlatformViewer,
):
  | { ok: true; value: ValidatedDocumentMeta }
  | { ok: false; errors: DocumentFieldErrors } {
  const errors: DocumentFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const title = text(input.title);
  if (title.length < TITLE_MIN) errors.title = 'Please enter a document title.';
  else if (title.length > TITLE_MAX)
    errors.title = `Please keep the title under ${TITLE_MAX} characters.`;

  const description = text(input.description);
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Please keep the description under ${DESCRIPTION_MAX} characters.`;

  const category = text(input.category);
  if (!isDocumentCategory(category))
    errors.category = 'Please choose a category.';

  const jobSiteId = text(input.jobSiteId);
  if (!jobSiteId) errors.jobSiteId = 'Please choose a site.';
  else if (!viewer.siteIds.includes(jobSiteId))
    errors.jobSiteId = 'That site is not in your access.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description: description || null,
      category: category as DocumentCategory,
      jobSiteId,
    },
  };
}

/** Validate an uploaded file's size and content type. */
export function validateUploadFile(
  file: { size: number; type: string } | null,
): { ok: true } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: 'Please choose a file to upload.' };
  if (file.size > MAX_DOCUMENT_BYTES)
    return { ok: false, error: 'That file is too large (max 20 MB).' };
  if (!ACCEPTED_DOCUMENT_MIME_TYPES.includes(file.type as never))
    return {
      ok: false,
      error: 'That file type is not supported. Use PDF, image, Word, Excel or text.',
    };
  return { ok: true };
}

export interface DocumentListFilters {
  category?: string;
  siteId?: string;
}

/** Site-scoped list of documents for the viewer, newest first. */
export async function listDocuments(
  viewer: PlatformViewer,
  filters: DocumentListFilters = {},
) {
  // Constrain to the viewer's sites; narrow further to one site if requested
  // (and only if that site is in scope).
  const siteIds =
    filters.siteId && viewer.siteIds.includes(filters.siteId)
      ? [filters.siteId]
      : viewer.siteIds;

  if (siteIds.length === 0) return [];

  const category =
    filters.category && isDocumentCategory(filters.category)
      ? (filters.category as DocumentCategory)
      : undefined;

  return prisma.document.findMany({
    where: { jobSiteId: { in: siteIds }, category },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedByName: true,
      createdAt: true,
      jobSite: { select: { id: true, name: true, jobReference: true } },
    },
  });
}

/**
 * Fetch a single document only if it's within the viewer's scope; null
 * otherwise (used for the detail page, edit and download).
 */
export async function getDocumentForViewer(viewer: PlatformViewer, id: string) {
  if (viewer.siteIds.length === 0) return null;
  const doc = await prisma.document.findFirst({
    where: { id, jobSiteId: { in: viewer.siteIds } },
    include: {
      jobSite: { select: { id: true, name: true, jobReference: true } },
    },
  });
  return doc;
}

/**
 * Create a document: upload the bytes to private blob storage, then write the
 * DB row. If the DB write fails the blob is cleaned up so nothing is orphaned.
 */
export async function createDocument(
  viewer: PlatformViewer,
  meta: ValidatedDocumentMeta,
  file: { buffer: Buffer; fileName: string; mimeType: string; size: number },
): Promise<{ id: string }> {
  const blobPath = buildBlobPath(meta.jobSiteId, file.fileName);
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  try {
    const created = await prisma.document.create({
      data: {
        title: meta.title,
        description: meta.description,
        category: meta.category,
        jobSiteId: meta.jobSiteId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        blobPath,
        uploadedByUserId: viewer.id,
        uploadedByName: viewer.name,
      },
      select: { id: true },
    });
    return created;
  } catch (error) {
    await deleteDocumentBlob(blobPath);
    throw error;
  }
}

/**
 * Update a document's metadata / site assignment. Both the existing site and the
 * target site must be within the viewer's scope. Returns null if the document is
 * not in scope.
 */
export async function updateDocument(
  viewer: PlatformViewer,
  id: string,
  meta: ValidatedDocumentMeta,
): Promise<{ id: string } | null> {
  const existing = await getDocumentForViewer(viewer, id);
  if (!existing) return null;
  return prisma.document.update({
    where: { id },
    data: {
      title: meta.title,
      description: meta.description,
      category: meta.category,
      jobSiteId: meta.jobSiteId,
    },
    select: { id: true },
  });
}

/**
 * Permanently delete a document within the viewer's scope: remove the DB row
 * first (the authoritative record), then delete the blob. Returns false if the
 * document is not in scope (so the caller can 404). The metadata row is always
 * gone on success; blob deletion is best-effort, so at worst an orphaned blob
 * remains — never a metadata row pointing at a missing file.
 */
export async function deleteDocument(
  viewer: PlatformViewer,
  id: string,
): Promise<boolean> {
  const existing = await getDocumentForViewer(viewer, id);
  if (!existing) return false;
  await prisma.document.delete({ where: { id } });
  await deleteDocumentBlob(existing.blobPath);
  return true;
}
