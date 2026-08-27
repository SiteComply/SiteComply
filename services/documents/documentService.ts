import { DocumentCategory, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { DocumentAnnotationMeta } from '@/services/annotations/annotationUpload';
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';
import { viewerSiteIdsFor } from '@/services/platformUsers/effectivePermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isDocumentCategory,
  MAX_DOCUMENT_BYTES,
  ACCEPTED_DOCUMENT_MIME_TYPES,
  EXPIRING_SOON_DAYS,
  isDocumentExpiryFilter,
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
  /** Optional expiry as a yyyy-mm-dd date string (empty = no expiry). */
  expiresAt?: string;
}

export interface ValidatedDocumentMeta {
  title: string;
  description: string | null;
  category: DocumentCategory;
  jobSiteId: string;
  expiresAt: Date | null;
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

  // Optional expiry — a yyyy-mm-dd date, stored at UTC midnight. Blank = null.
  let expiresAt: Date | null = null;
  const rawExpiry = text(input.expiresAt);
  if (rawExpiry !== '') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawExpiry);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    // The month round-trip check rejects impossible dates like 2026-02-31.
    if (!d || Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m![2] - 1) {
      errors.expiresAt = 'Enter a valid expiry date.';
    } else {
      expiresAt = d;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description: description || null,
      category: category as DocumentCategory,
      jobSiteId,
      expiresAt,
    },
  };
}

/** Validate an uploaded file's size and content type. */
export function validateUploadFile(
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
        'That file type is not supported. Use PDF, image, Word, Excel or text.',
    };
  return { ok: true };
}

export interface DocumentListFilters {
  category?: string;
  siteId?: string;
  /** Expiry status filter: "valid" | "expiring" | "expired" | "none" (else all). */
  expiry?: string;
  /** Free-text search over title, file name and description. */
  search?: string;
  /** Pagination (omit for the full list). */
  skip?: number;
  take?: number;
}

/** Whole UTC day boundaries used for expiry filtering (matches documentExpiryStatus). */
function expiryBoundaries(now = new Date()) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const soon = new Date(
    today.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000,
  );
  return { today, soon };
}

/**
 * Build the site-scoped where clause shared by listDocuments + countDocuments so
 * the two never drift. Returns null when the viewer has no sites (empty list).
 */
async function documentWhere(
  viewer: PlatformViewer,
  filters: DocumentListFilters,
): Promise<Prisma.DocumentWhereInput | null> {
  // SC-022: the module's OWN access boundary, not the viewer's whole site list.
  // A contractor narrowed out of documents on one site keeps their other sites,
  // and the exclusion happens in the query rather than being filtered out after
  // the rows have already been read.
  const scoped = viewerSiteIdsFor(viewer, 'documents');
  const siteIds =
    filters.siteId && scoped.includes(filters.siteId)
      ? [filters.siteId]
      : scoped;
  if (siteIds.length === 0) return null;

  const category =
    filters.category && isDocumentCategory(filters.category)
      ? (filters.category as DocumentCategory)
      : undefined;

  // Expiry filter — only documents WITH an expiry date match a specific status;
  // documents without an expiry appear only under "none" / "all".
  let expiresAt: Prisma.DateTimeNullableFilter | null | undefined;
  if (filters.expiry && isDocumentExpiryFilter(filters.expiry)) {
    const { today, soon } = expiryBoundaries();
    if (filters.expiry === 'expired') expiresAt = { lt: today };
    else if (filters.expiry === 'expiring')
      expiresAt = { gte: today, lte: soon };
    else if (filters.expiry === 'valid') expiresAt = { gt: soon };
    else expiresAt = null; // none — documents with no expiry date
  }

  const q = (filters.search ?? '').trim();
  const search: Prisma.DocumentWhereInput | undefined = q
    ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { fileName: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      }
    : undefined;

  // One document, not two. An original that has been annotated is superseded by
  // its annotated copy and drops out here — in the QUERY, not afterwards. The
  // register is server-paginated, so filtering the rows after the fact would let
  // superseded originals consume slots and then vanish, quietly returning short
  // pages and a total that disagrees with them. Because `countDocuments` and
  // `listDocuments` both come through this function, the two cannot drift.
  //
  // Documents module only — audit and action evidence keep their own rule and
  // still show original and annotated separately. See `supersededDocuments.ts`.
  const superseded = await supersededDocumentIds(siteIds);

  return {
    jobSiteId: { in: siteIds },
    category,
    expiresAt,
    ...search,
    id: superseded.length > 0 ? { notIn: superseded } : undefined,
  };
}

/** Count of documents matching the (scoped) filters — for pagination totals. */
export async function countDocuments(
  viewer: PlatformViewer,
  filters: DocumentListFilters = {},
): Promise<number> {
  const where = await documentWhere(viewer, filters);
  if (!where) return 0;
  return prisma.document.count({ where });
}

/** Site-scoped list of documents for the viewer, newest first. */
export async function listDocuments(
  viewer: PlatformViewer,
  filters: DocumentListFilters = {},
) {
  const where = await documentWhere(viewer, filters);
  if (!where) return [];

  return prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: filters.skip,
    take: filters.take,
    select: {
      id: true,
      title: true,
      category: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      expiresAt: true,
      uploadedByName: true,
      createdAt: true,
      jobSite: { select: { id: true, name: true, jobReference: true } },
      // SC-017 UX: so the register can mark an annotated copy and the original
      // it came from, rather than showing two near-identical rows.
      annotated: true,
      originalDocumentId: true,
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
  annotation?: DocumentAnnotationMeta,
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
        expiresAt: meta.expiresAt,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        blobPath,
        uploadedByUserId: viewer.id,
        uploadedByName: viewer.name,
        // SC-017 — set only on the annotated COPY. The original document row is
        // created first and left untouched, exactly as for evidence.
        annotated: annotation?.annotated ?? false,
        originalDocumentId: annotation?.originalDocumentId ?? null,
        annotationData: annotation?.annotationData
          ? (annotation.annotationData as unknown as Prisma.InputJsonValue)
          : undefined,
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
      expiresAt: meta.expiresAt,
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
