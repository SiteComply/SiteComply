import {
  AuditStatus,
  FindingCategory,
  OccurrenceStatus,
  Prisma,
  QuestionScoringRule,
  ScoringMethod,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isActivityTypeAvailable } from '@/services/siteServices/siteServiceAvailability';
import { viewerSiteIdsFor } from '@/services/platformUsers/effectivePermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';
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
  /** SC-013: when creating from a template, its id (items are copied in). */
  templateId?: string;
}

export interface ValidatedAuditMeta {
  title: string;
  description: string | null;
  observations: string | null;
  overallScore: number | null;
  jobSiteId: string;
  documentIds: string[];
  templateId: string | null;
}

export type AuditFieldErrors = Partial<Record<keyof AuditMetaInput, string>>;

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
        new Set(
          input.documentIds.filter((s): s is string => typeof s === 'string'),
        ),
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
      templateId:
        typeof input.templateId === 'string' && input.templateId
          ? input.templateId
          : null,
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
  /**
   * Outstanding only = not yet signed off (Draft / In progress / Awaiting
   * sign-off). Ignored when an explicit `status` filter is set.
   */
  outstanding?: boolean;
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
  // SC-022: the module's OWN access boundary, not the viewer's whole site list.
  // A contractor narrowed out of audits on one site keeps their other sites,
  // and the exclusion happens in the query rather than being filtered out after
  // the rows have already been read.
  const scoped = viewerSiteIdsFor(viewer, 'audits');
  const siteIds =
    filters.siteId && scoped.includes(filters.siteId)
      ? [filters.siteId]
      : scoped;
  if (siteIds.length === 0) return null;

  const explicitStatus =
    filters.status && isAuditStatus(filters.status)
      ? (filters.status as AuditStatus)
      : undefined;
  // Outstanding = every status except SIGNED_OFF (Draft / In progress /
  // Awaiting sign-off). An explicit status filter takes precedence.
  const status: Prisma.AuditWhereInput['status'] = explicitStatus
    ? explicitStatus
    : filters.outstanding
      ? { not: 'SIGNED_OFF' }
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

const AUDIT_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  overallScore: true,
  createdByName: true,
  createdAt: true,
  jobSite: { select: { id: true, name: true, jobReference: true } },
  _count: { select: { documents: true } },
  // SC-014: the calculated score supersedes the manual one in the register when
  // scoring is enabled for that audit.
  scoringEnabled: true,
  calculatedPercent: true,
  calculatedScore: true,
  calculatedPassed: true,
  totalPossibleScore: true,
  showAsPercentage: true,
} satisfies Prisma.AuditSelect;

/**
 * SC-014 — how an audit's score should read in a list, register or export. One
 * helper so the register, CSV and any report present the score identically.
 */
export function auditScoreLabel(audit: {
  scoringEnabled: boolean;
  overallScore: number | null;
  calculatedPercent: number | null;
  calculatedScore: number | null;
  totalPossibleScore: number;
  showAsPercentage: boolean;
}): string {
  if (!audit.scoringEnabled) {
    return audit.overallScore === null ? '—' : `${audit.overallScore}%`;
  }
  if (audit.calculatedPercent === null) return 'Not yet scored';
  return audit.showAsPercentage
    ? `${audit.calculatedPercent}%`
    : `${audit.calculatedScore} / ${audit.totalPossibleScore}`;
}

/** SC-014 — Pass / Fail / — for registers and exports. */
export function auditResultLabel(audit: {
  scoringEnabled: boolean;
  calculatedPassed: boolean | null;
}): string {
  if (!audit.scoringEnabled || audit.calculatedPassed === null) return '—';
  return audit.calculatedPassed ? 'Pass' : 'Fail';
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
    // A UNIQUE TIEBREAKER, NOT TIDINESS. Every key above can tie, so without a
    // unique last key Postgres may return tied rows in any order and may choose
    // differently on each query. With skip/take paging that means a row can
    // appear on two pages while another appears on none — invisible on page one
    // and only under paging. Ties are not rare here: rows created together in
    // one transaction share createdAt exactly.
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: filters.skip,
    take: filters.take,
    select: AUDIT_LIST_SELECT,
  });
}

/**
 * Outstanding (not-signed-off) audits for a single site, ordered for operational
 * focus: by status — Awaiting sign-off → In progress → Draft (the enum orders
 * DRAFT<IN_PROGRESS<COMPLETED<SIGNED_OFF, so `desc` with SIGNED_OFF excluded
 * yields that order) — then longest outstanding first. Powers the Site Details
 * panel; RBAC + site-scoping are enforced via `auditWhere` (out-of-scope or
 * no-sites → []). Signed-off / historical audits stay in the Audits register.
 */
export async function listOutstandingAuditsForSite(
  viewer: PlatformViewer,
  siteId: string,
  take: number,
) {
  const where = auditWhere(viewer, { siteId, outstanding: true });
  if (!where) return [];

  return prisma.audit.findMany({
    where,
    orderBy: [{ status: 'desc' }, { createdAt: 'asc' }],
    take,
    select: AUDIT_LIST_SELECT,
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
      // SC-013: the audit's checklist items (copied from a template at creation).
      items: { orderBy: { order: 'asc' } },
      // SC-014: weighted sections + custom score bands for the scoring panel.
      sections: { orderBy: { order: 'asc' } },
      scoreBands: { orderBy: { order: 'asc' } },
    },
  });
}

export async function createAudit(
  viewer: PlatformViewer,
  value: ValidatedAuditMeta,
): Promise<{ ok: true; id: string } | { ok: false; errors: AuditFieldErrors }> {
  const docs = await resolveDocumentIds(
    viewer,
    value.jobSiteId,
    value.documentIds,
  );
  if (!docs.ok) return { ok: false, errors: { documentIds: docs.error } };

  // SC-013: when creating from a template, copy its items onto the audit as its
  // checklist and snapshot the template's identity/version for provenance. The
  // copy means later template edits never alter this audit (snapshot-on-use).
  // SC-014 extends the same snapshot to the template's SECTIONS and scoring
  // configuration, so a template captures a whole audit format — structure,
  // weightings and how it scores — not just a list of questions.
  let items: {
    label: string;
    helpText: string | null;
    category: FindingCategory;
    order: number;
    /** Index into `sections` below; resolved to a real id after creation. */
    sectionIndex: number | null;
    scoringRule: QuestionScoringRule;
    points: number;
    mandatory: boolean;
  }[] = [];
  let sections: { name: string; weightPercent: number; order: number }[] = [];
  let scoring: {
    scoringEnabled: boolean;
    scoringMethod: ScoringMethod;
    totalPossibleScore: number;
    passingScore: number;
    showAsPercentage: boolean;
    roundScores: boolean;
  } | null = null;
  let bands: {
    label: string;
    minScore: number;
    maxScore: number;
    tone: string;
    order: number;
  }[] = [];
  let snapshot: {
    sourceTemplateId: string;
    sourceTemplateName: string;
    sourceTemplateVersion: number;
  } | null = null;
  if (value.templateId) {
    // SC-021 — SERVER-SIDE ENFORCEMENT. The form hides templates this site has
    // switched off, but the id is postable, so availability is re-checked here.
    // Refused outright rather than silently creating a blank audit: a manager
    // who picked a template must not end up with an empty checklist and no
    // explanation of why.
    if (!(await isActivityTypeAvailable(value.jobSiteId, value.templateId))) {
      return {
        ok: false,
        errors: {
          templateId:
            'That inspection type is not available for the selected site.',
        },
      };
    }
    const template = await prisma.auditTemplate.findFirst({
      where: { id: value.templateId, active: true },
      include: {
        items: { orderBy: { order: 'asc' } },
        sections: { orderBy: { order: 'asc' } },
        scoreBands: { orderBy: { order: 'asc' } },
      },
    });
    if (template) {
      sections = template.sections.map((s, idx) => ({
        name: s.name,
        weightPercent: s.weightPercent,
        order: idx,
      }));
      const sectionIndexById = new Map(
        template.sections.map((s, idx) => [s.id, idx]),
      );
      items = template.items.map((it, idx) => ({
        label: it.label,
        helpText: it.helpText,
        category: it.category,
        order: idx,
        sectionIndex:
          it.sectionId !== null
            ? (sectionIndexById.get(it.sectionId) ?? null)
            : null,
        scoringRule: it.scoringRule,
        points: it.points,
        mandatory: it.mandatory,
      }));
      scoring = {
        scoringEnabled: template.scoringEnabled,
        scoringMethod: template.scoringMethod,
        totalPossibleScore: template.totalPossibleScore,
        passingScore: template.passingScore,
        showAsPercentage: template.showAsPercentage,
        roundScores: template.roundScores,
      };
      bands = template.scoreBands.map((b, idx) => ({
        label: b.label,
        minScore: b.minScore,
        maxScore: b.maxScore,
        tone: b.tone,
        order: idx,
      }));
      snapshot = {
        sourceTemplateId: template.id,
        sourceTemplateName: template.name,
        sourceTemplateVersion: template.version,
      };
    }
  }

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
      ...(snapshot ?? {}),
      ...(scoring ?? {}),
      ...(sections.length ? { sections: { create: sections } } : {}),
      ...(bands.length ? { scoreBands: { create: bands } } : {}),
    },
    select: { id: true },
  });

  // Items are created after the audit so they can be linked to the sections we
  // just created (nested creates can't cross-reference sibling records).
  if (items.length > 0) {
    const createdSections = await prisma.auditSection.findMany({
      where: { auditId: created.id },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    await prisma.auditItem.createMany({
      data: items.map((it) => ({
        auditId: created.id,
        label: it.label,
        helpText: it.helpText,
        category: it.category,
        order: it.order,
        sectionId:
          it.sectionIndex !== null
            ? (createdSections[it.sectionIndex]?.id ?? null)
            : null,
        scoringRule: it.scoringRule,
        points: it.points,
        mandatory: it.mandatory,
      })),
    });
  }

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

  const docs = await resolveDocumentIds(
    viewer,
    value.jobSiteId,
    value.documentIds,
  );
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

  // SC-020 FOLLOW-UP — a compliance activity that was STARTED from this audit
  // has to go back to being merely scheduled.
  //
  // The foreign key is `onDelete: SetNull`, so deleting the audit cleared
  // `auditId` and left `status` exactly as it was. The occurrence therefore
  // stayed IN_PROGRESS (or COMPLETED) for ever, with nothing behind it: the
  // calendar went on showing a deleted inspection as under way or done, and the
  // completion-rate KPI and the compliance-activities report went on counting it
  // as work that happened. A ghost on a compliance record is worse than a gap —
  // it reads as evidence.
  //
  // Reset, not delete: the SCHEDULE still says this activity is due on this
  // date, and `ensureOccurrences` would regenerate the row anyway (it is
  // idempotent on scheduleId + dueAt). Back to SCHEDULED is the truth — nobody
  // did it — and it can be started again.
  //
  // `escalatedAt` and `escalatedToRole` are deliberately LEFT ALONE. If this
  // activity went overdue and management was told, that happened, and SC-020
  // Phase 2 keeps escalations as stored fact precisely so "was management told,
  // and when" stays answerable. Clearing it would also let the same escalation
  // fire a second time.
  //
  // One transaction, so the audit cannot disappear while an occurrence still
  // claims to be running it.
  await prisma.$transaction(async (tx) => {
    await tx.complianceOccurrence.updateMany({
      where: { auditId: id },
      data: { auditId: null, status: OccurrenceStatus.SCHEDULED },
    });
    await tx.audit.delete({ where: { id } });
  });
  return true;
}

/**
 * Documents the viewer may reference from an audit, for the create/edit form to
 * offer per selected site. Kept lightweight (no blob data).
 */
export async function listReferenceableDocuments(viewer: PlatformViewer) {
  if (viewer.siteIds.length === 0) return [];
  // The DOCUMENT picker, so it follows the Documents module's rule: an original
  // that has been annotated is superseded by its copy and is not offered, or the
  // list shows two entries with the same title and no way to tell them apart.
  // This does not touch the audit's own photo evidence, which deliberately keeps
  // original and annotated distinct.
  const superseded = await supersededDocumentIds(viewer.siteIds);
  return prisma.document.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      id: superseded.length > 0 ? { notIn: superseded } : undefined,
    },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, jobSiteId: true, category: true },
  });
}
