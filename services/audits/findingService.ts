import {
  FindingCategory,
  FindingSeverity,
  FindingStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { zonedMidnightToUtc } from '@/lib/datetime';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isFindingCategory,
  isFindingSeverity,
  isFindingStatus,
  FINDING_TITLE_MAX,
  FINDING_DESCRIPTION_MAX,
  FINDING_ACTION_MAX,
} from '@/services/audits/findingConstants';

/**
 * Audit findings service (Audits Phase 2).
 *
 * Findings inherit their parent audit's site scope — there is no site column;
 * access is resolved through `audit.jobSiteId ∈ viewer.siteIds`, so a user can
 * never see or touch a finding on a site outside their scope. Role-based checks
 * (view via 'view', create/edit/close via 'edit') live in the routes.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FindingInput {
  title?: string;
  description?: string;
  category?: string;
  severity?: string;
  status?: string;
  dueDate?: string;
  correctiveAction?: string;
}

export interface ValidatedFinding {
  title: string;
  description: string | null;
  category: FindingCategory;
  severity: FindingSeverity;
  status: FindingStatus;
  dueDate: Date | null;
  correctiveAction: string | null;
}

export type FindingFieldErrors = Partial<Record<keyof FindingInput, string>>;

export function validateFinding(
  input: FindingInput,
):
  | { ok: true; value: ValidatedFinding }
  | { ok: false; errors: FindingFieldErrors } {
  const errors: FindingFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const title = text(input.title);
  if (title.length < 2) errors.title = 'Please enter a finding title.';
  else if (title.length > FINDING_TITLE_MAX)
    errors.title = `Please keep the title under ${FINDING_TITLE_MAX} characters.`;

  const description = text(input.description);
  if (description.length > FINDING_DESCRIPTION_MAX)
    errors.description = `Please keep the description under ${FINDING_DESCRIPTION_MAX} characters.`;

  const correctiveAction = text(input.correctiveAction);
  if (correctiveAction.length > FINDING_ACTION_MAX)
    errors.correctiveAction = `Please keep the corrective action under ${FINDING_ACTION_MAX} characters.`;

  const category = text(input.category) || 'OTHER';
  if (!isFindingCategory(category))
    errors.category = 'Please choose a category.';

  const severity = text(input.severity) || 'MEDIUM';
  if (!isFindingSeverity(severity))
    errors.severity = 'Please choose a severity.';

  const status = text(input.status) || 'OPEN';
  if (!isFindingStatus(status)) errors.status = 'Please choose a status.';

  let dueDate: Date | null = null;
  const rawDue = text(input.dueDate);
  if (rawDue !== '') {
    if (!DATE_RE.test(rawDue) || Number.isNaN(new Date(rawDue).getTime()))
      errors.dueDate = 'Please enter a valid date.';
    else dueDate = zonedMidnightToUtc(rawDue);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description: description || null,
      category: category as FindingCategory,
      severity: severity as FindingSeverity,
      status: status as FindingStatus,
      dueDate,
      correctiveAction: correctiveAction || null,
    },
  };
}

/** Is this audit within the viewer's site scope? */
async function auditInScope(
  viewer: PlatformViewer,
  auditId: string,
): Promise<boolean> {
  if (viewer.siteIds.length === 0) return false;
  const audit = await prisma.audit.findFirst({
    where: { id: auditId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  return !!audit;
}

/** A finding, only if its audit is within the viewer's scope; null otherwise. */
export async function getFindingForViewer(
  viewer: PlatformViewer,
  findingId: string,
) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.auditFinding.findFirst({
    where: { id: findingId, audit: { jobSiteId: { in: viewer.siteIds } } },
  });
}

/** All findings for an audit, ordered by severity (worst first) then newest. */
export function listFindingsForAudit(auditId: string) {
  return prisma.auditFinding.findMany({
    where: { auditId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function createFinding(
  viewer: PlatformViewer,
  auditId: string,
  value: ValidatedFinding,
): Promise<{ id: string } | null> {
  if (!(await auditInScope(viewer, auditId))) return null;
  const created = await prisma.auditFinding.create({
    data: {
      auditId,
      title: value.title,
      description: value.description,
      category: value.category,
      severity: value.severity,
      status: value.status,
      dueDate: value.dueDate,
      correctiveAction: value.correctiveAction,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      closedAt: value.status === FindingStatus.CLOSED ? new Date() : null,
    },
    select: { id: true },
  });
  return created;
}

export async function updateFinding(
  viewer: PlatformViewer,
  findingId: string,
  value: ValidatedFinding,
): Promise<{ id: string } | null> {
  const existing = await getFindingForViewer(viewer, findingId);
  if (!existing) return null;
  await prisma.auditFinding.update({
    where: { id: findingId },
    data: {
      title: value.title,
      description: value.description,
      category: value.category,
      severity: value.severity,
      status: value.status,
      dueDate: value.dueDate,
      correctiveAction: value.correctiveAction,
      closedAt:
        value.status === FindingStatus.CLOSED
          ? (existing.closedAt ?? new Date())
          : null,
    },
  });
  return { id: findingId };
}

/** Quick status change (e.g. close / reopen) within the viewer's scope. */
export async function setFindingStatus(
  viewer: PlatformViewer,
  findingId: string,
  status: FindingStatus,
): Promise<boolean> {
  const existing = await getFindingForViewer(viewer, findingId);
  if (!existing) return false;
  await prisma.auditFinding.update({
    where: { id: findingId },
    data: {
      status,
      closedAt:
        status === FindingStatus.CLOSED
          ? (existing.closedAt ?? new Date())
          : null,
    },
  });
  return true;
}
