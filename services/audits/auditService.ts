import { AuditStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isAuditStatus,
  SCORE_MIN,
  SCORE_MAX,
  TITLE_MAX,
  DESCRIPTION_MAX,
  OBSERVATIONS_MAX,
} from '@/services/audits/auditConstants';

/**
 * Audits module service (Phase 1).
 *
 * All reads and writes are site-scoped: an audit belongs to exactly one site,
 * and every query is constrained to the viewer's accessible `siteIds`, so a user
 * can never see or touch an audit for a site outside their scope. Role-based
 * permission checks (view/create/edit) live in the routes/pages via `permits`;
 * the site boundary is enforced here as defence in depth.
 *
 * Findings, actions and photo uploads are intentionally out of scope for Phase 1.
 */

export interface AuditMetaInput {
  title?: string;
  description?: string;
  observations?: string;
  overallScore?: string | number | null;
  jobSiteId?: string;
  documentIds?: string[];
}

export interface ValidatedAuditMeta {
  title: string;
  description: string | null;
  observations: string | null;
  overallScore: number | null;
  jobSiteId: string;
  documentIds: string[];
}

export type AuditFieldErrors = Partial<
  Record<keyof AuditMetaInput, string>
>;

/**
 * Validate audit metadata against the viewer's scope. `jobSiteId` must be a site
 * the viewer can access. Document references are validated against the DB in
 * create/update (they must belong to the same site and be in scope).
 */
export function validateAuditMeta(
  input: AuditMetaInput,
  viewer: PlatformViewer,
):
  | { ok: true; value: ValidatedAuditMeta }
  | { ok: false; errors: AuditFieldErrors } {
  const errors: AuditFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const title = text(input.title);
  if (title.length < 2) errors.title = 'Please enter an audit title.';
  else if (title.length > TITLE_MAX)
    errors.title = `Please keep the title under ${TITLE_MAX} characters.`;

  const description = text(input.description);
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Please keep the description under ${DESCRIPTION_MAX} characters.`;

  const observations = text(input.observations);
  if (observations.length > OBSERVATIONS_MAX)
    errors.observations = `Please keep observations under ${OBSERVATIONS_MAX} characters.`;

  let overallScore: number | null = null;
  const rawScore =
    typeof input.overallScore === 'number'
      ? String(input.overallScore)
      : text(input.overallScore ?? undefined);
  if (rawScore !== '') {
    const n = Number(rawScore);
    if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX)
      errors.overallScore = `Enter a whole number between ${SCORE_MIN} and ${SCORE_MAX}.`;
    else overallScore = n;
  }

  const jobSiteId = text(input.jobSiteId);
  if (!jobSiteId) errors.jobSiteId = 'Please choose a site.';
  else if (!viewer.siteIds.includes(jobSiteId))
    errors.jobSiteId = 'That site is not in your access.';

  const documentIds = Array.isArray(input.documentIds)
    ? Array.from(
        new Set(input.documentIds.filter((s): s is string => typeof s === 'string')),
      )
    : [];

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description: description || null,
      observations: observations || null,
      overallScore,
      jobSiteId,
      documentIds,
    },
  };
}

/**
 * Restrict referenced document ids to those that belong to the audit's site AND
 * are within the viewer's scope. Returns the accepted ids, or an error if any id
 * was not valid (so we never silently drop a chosen reference).
 */
async function resolveDocumentIds(
  viewer: PlatformViewer,
  jobSiteId: string,
  documentIds: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (documentIds.length === 0) return { ok: true, ids: [] };
  if (!viewer.siteIds.includes(jobSiteId))
    return { ok: false, error: 'That site is not in your access.' };

  const found = await prisma.document.findMany({
    where: { id: { in: documentIds }, jobSiteId },
    select: { id: true },
  });
  if (found.length !== documentIds.length)
    return {
      ok: false,
      error: 'Some selected documents are not available for this site.',
    };
  return { ok: true, ids: found.map((d) => d.id) };
}

export interface AuditListFilters {
  status?: string;
  siteId?: string;
  /** Free-text search over title and description. */
  search?: string;
  /** Pagination (omit for the full list). */
  skip?: number;
  take?: number;
}

/** Shared site-scoped where clause for listAudits + countAudits. Null → no sites. */
function auditWhere(
  viewer: PlatformViewer,
  filters: AuditListFilters,
): Prisma.AuditWhereInput | null {
  const siteIds =
    filters.siteId && viewer.siteIds.includes(filters.siteId)
      ? [filters.siteId]
      : viewer.siteIds;
  if (siteIds.length === 0) return null;

  const status =
    filters.status && isAuditStatus(filters.status)
      ? (filters.status as AuditStatus)
      : undefined;

  const q = (filters.search ?? '').trim();
  const search: Prisma.AuditWhereInput | undefined = q
    ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      }
    : undefined;

  return { jobSiteId: { in: siteIds }, status, ...search };
}

/** Count of audits matching the (scoped) filters — for pagination totals. */
export async function countAudits(
  viewer: PlatformViewer,
  filters: AuditListFilters = {},
): Promise<number> {
  const where = auditWhere(viewer, filters);
  if (!where) return 0;
  return prisma.audit.count({ where });
}

/** Site-scoped list of audits for the viewer, newest first. */
export async function listAudits(
  viewer: PlatformViewer,
  filters: AuditListFilters = {},
) {
  const where = auditWhere(viewer, filters);
  if (!where) return [];

  return prisma.audit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: filters.skip,
    take: filters.take,
    select: {
      id: true,
      title: true,
      status: true,
      overallScore: true,
      createdByName: true,
      createdAt: true,
      jobSite: { select: { id: true, name: true, jobReference: true } },
      _count: { select: { documents: true } },
    },
  });
}

/** Fetch a single audit only if within the viewer's scope; null otherwise. */
export async function getAuditForViewer(viewer: PlatformViewer, id: string) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.audit.findFirst({
    where: { id, jobSiteId: { in: viewer.siteIds } },
    include: {
      jobSite: { select: { id: true, name: true, jobReference: true } },
      documents: {
        select: { id: true, title: true, category: true, fileName: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function createAudit(
  viewer: PlatformViewer,
  value: ValidatedAuditMeta,
): Promise<{ ok: true; id: string } | { ok: false; errors: AuditFieldErrors }> {
  const docs = await resolveDocumentIds(viewer, value.jobSiteId, value.documentIds);
  if (!docs.ok) return { ok: false, errors: { documentIds: docs.error } };

  const created = await prisma.audit.create({
    data: {
      title: value.title,
      description: value.description,
      observations: value.observations,
      overallScore: value.overallScore,
      jobSiteId: value.jobSiteId,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      documents: { connect: docs.ids.map((id) => ({ id })) },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function updateAudit(
  viewer: PlatformViewer,
  id: string,
  value: ValidatedAuditMeta,
): Promise<
  | { ok: true; id: string }
  | { ok: false; errors: AuditFieldErrors }
  | { ok: false; notFound: true }
> {
  const existing = await getAuditForViewer(viewer, id);
  if (!existing) return { ok: false, notFound: true };

  const docs = await resolveDocumentIds(viewer, value.jobSiteId, value.documentIds);
  if (!docs.ok) return { ok: false, errors: { documentIds: docs.error } };

  await prisma.audit.update({
    where: { id },
    data: {
      title: value.title,
      description: value.description,
      observations: value.observations,
      overallScore: value.overallScore,
      jobSiteId: value.jobSiteId,
      documents: { set: docs.ids.map((docId) => ({ id: docId })) },
    },
  });
  return { ok: true, id };
}

/**
 * Change an audit's status within the viewer's scope. Moving to SIGNED_OFF
 * records the signatory (viewer) and time — a fresh sign-off, so re-signing after
 * a reopen overwrites the previous signatory. Moving AWAY from SIGNED_OFF (a
 * reopen) deliberately PRESERVES the last sign-off fields as the record of who
 * signed it off and when; the signatory is never silently removed. The status
 * route restricts both signing off and reopening to the sign-off allow-list, so a
 * signed audit can't be reverted by an edit-only role. Returns false if the audit
 * is not in scope.
 */
export async function setAuditStatus(
  viewer: PlatformViewer,
  id: string,
  status: AuditStatus,
): Promise<boolean> {
  const existing = await getAuditForViewer(viewer, id);
  if (!existing) return false;

  // Only a transition INTO SIGNED_OFF touches the sign-off fields; every other
  // transition leaves them untouched, so a prior sign-off is preserved on reopen.
  const signOff =
    status === AuditStatus.SIGNED_OFF
      ? {
          signedOffByUserId: viewer.id,
          signedOffByName: viewer.name,
          signedOffAt: new Date(),
        }
      : {};

  await prisma.audit.update({ where: { id }, data: { status, ...signOff } });
  return true;
}

/**
 * Permanently delete an audit within the viewer's scope. Related findings (and
 * the audit↔document join rows) are removed via the schema's ON DELETE CASCADE;
 * the referenced Documents themselves are left intact. Returns false if the
 * audit is not in scope. The caller enforces the delete-role allow-list.
 */
export async function deleteAudit(
  viewer: PlatformViewer,
  id: string,
): Promise<boolean> {
  const existing = await getAuditForViewer(viewer, id);
  if (!existing) return false;
  await prisma.audit.delete({ where: { id } });
  return true;
}

/**
 * Documents the viewer may reference from an audit, for the create/edit form to
 * offer per selected site. Kept lightweight (no blob data).
 */
export async function listReferenceableDocuments(viewer: PlatformViewer) {
  if (viewer.siteIds.length === 0) return [];
  return prisma.document.findMany({
    where: { jobSiteId: { in: viewer.siteIds } },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, jobSiteId: true, category: true },
  });
}
