import { ActionPriority, ActionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { zonedMidnightToUtc } from '@/lib/datetime';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isActionPriority,
  isActionStatus,
  isActionBucket,
  ACTION_TITLE_MAX,
  ACTION_DESCRIPTION_MAX,
  ACTION_ASSIGNEE_MAX,
  type ActionBucket,
} from '@/services/actions/actionConstants';

/**
 * Actions module service (Phase 1) — the central corrective-action register.
 *
 * All reads/writes are site-scoped: an action belongs to exactly one site, and
 * every query is constrained to the viewer's accessible `siteIds`. Role-based
 * checks (view/create/edit) live in the routes via `permits`; the site boundary
 * is enforced here as defence in depth. "Overdue" is derived, never stored.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ActionInput {
  title?: string;
  description?: string;
  jobSiteId?: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  assignedTo?: string;
}

export interface ValidatedAction {
  title: string;
  description: string | null;
  jobSiteId: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate: Date | null;
  assignedTo: string | null;
}

export type ActionFieldErrors = Partial<Record<keyof ActionInput, string>>;

export function validateAction(
  input: ActionInput,
  viewer: PlatformViewer,
):
  | { ok: true; value: ValidatedAction }
  | { ok: false; errors: ActionFieldErrors } {
  const errors: ActionFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const title = text(input.title);
  if (title.length < 2) errors.title = 'Please enter an action title.';
  else if (title.length > ACTION_TITLE_MAX)
    errors.title = `Please keep the title under ${ACTION_TITLE_MAX} characters.`;

  const description = text(input.description);
  if (description.length > ACTION_DESCRIPTION_MAX)
    errors.description = `Please keep the description under ${ACTION_DESCRIPTION_MAX} characters.`;

  const assignedTo = text(input.assignedTo);
  if (assignedTo.length > ACTION_ASSIGNEE_MAX)
    errors.assignedTo = `Please keep the assignee under ${ACTION_ASSIGNEE_MAX} characters.`;

  const jobSiteId = text(input.jobSiteId);
  if (!jobSiteId) errors.jobSiteId = 'Please choose a site.';
  else if (!viewer.siteIds.includes(jobSiteId))
    errors.jobSiteId = 'That site is not in your access.';

  const priority = text(input.priority) || 'MEDIUM';
  if (!isActionPriority(priority)) errors.priority = 'Please choose a priority.';

  const status = text(input.status) || 'OPEN';
  if (!isActionStatus(status)) errors.status = 'Please choose a status.';

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
      jobSiteId,
      priority: priority as ActionPriority,
      status: status as ActionStatus,
      dueDate,
      assignedTo: assignedTo || null,
    },
  };
}

/** Build the where-clause for a register bucket, scoped to the given sites. */
function bucketWhere(
  siteIds: string[],
  bucket: ActionBucket | undefined,
  now: Date,
): Prisma.ActionWhereInput {
  const base: Prisma.ActionWhereInput = { jobSiteId: { in: siteIds } };
  switch (bucket) {
    case 'OPEN':
      return { ...base, status: 'OPEN' };
    case 'IN_PROGRESS':
      return { ...base, status: 'IN_PROGRESS' };
    case 'OVERDUE':
      return {
        ...base,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { lt: now },
      };
    case 'COMPLETED':
      return { ...base, status: 'COMPLETED' };
    default:
      return base;
  }
}

export interface ActionListFilters {
  bucket?: string;
  siteId?: string;
  priority?: string;
}

/** Site-scoped list of actions. Overdue first, then by due date, then newest. */
export async function listActions(
  viewer: PlatformViewer,
  filters: ActionListFilters = {},
  now: Date = new Date(),
) {
  const siteIds =
    filters.siteId && viewer.siteIds.includes(filters.siteId)
      ? [filters.siteId]
      : viewer.siteIds;
  if (siteIds.length === 0) return [];

  const bucket =
    filters.bucket && isActionBucket(filters.bucket)
      ? (filters.bucket as ActionBucket)
      : undefined;
  const where = bucketWhere(siteIds, bucket, now);
  if (filters.priority && isActionPriority(filters.priority))
    where.priority = filters.priority as ActionPriority;

  return prisma.action.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      priority: true,
      status: true,
      dueDate: true,
      assignedTo: true,
      auditFindingId: true,
      createdAt: true,
      jobSite: { select: { id: true, name: true, jobReference: true } },
    },
  });
}

/** Counts per register bucket (independent — an overdue action is also open). */
export async function actionCounts(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<Record<ActionBucket, number>> {
  const empty = { OPEN: 0, IN_PROGRESS: 0, OVERDUE: 0, COMPLETED: 0 };
  if (viewer.siteIds.length === 0) return empty;
  const site = { jobSiteId: { in: viewer.siteIds } };
  const [open, inProgress, overdue, completed] = await Promise.all([
    prisma.action.count({ where: { ...site, status: 'OPEN' } }),
    prisma.action.count({ where: { ...site, status: 'IN_PROGRESS' } }),
    prisma.action.count({
      where: { ...site, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: now } },
    }),
    prisma.action.count({ where: { ...site, status: 'COMPLETED' } }),
  ]);
  return { OPEN: open, IN_PROGRESS: inProgress, OVERDUE: overdue, COMPLETED: completed };
}

/** A single action if within the viewer's scope; null otherwise. */
export async function getActionForViewer(viewer: PlatformViewer, id: string) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.action.findFirst({
    where: { id, jobSiteId: { in: viewer.siteIds } },
    include: {
      jobSite: { select: { id: true, name: true, jobReference: true } },
      auditFinding: {
        select: {
          id: true,
          title: true,
          audit: { select: { id: true, title: true } },
        },
      },
    },
  });
}

export async function createAction(
  viewer: PlatformViewer,
  value: ValidatedAction,
): Promise<{ id: string }> {
  const created = await prisma.action.create({
    data: {
      ...value,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      completedAt: value.status === ActionStatus.COMPLETED ? new Date() : null,
    },
    select: { id: true },
  });
  return created;
}

export async function updateAction(
  viewer: PlatformViewer,
  id: string,
  value: ValidatedAction,
): Promise<{ id: string } | null> {
  const existing = await getActionForViewer(viewer, id);
  if (!existing) return null;
  await prisma.action.update({
    where: { id },
    data: {
      title: value.title,
      description: value.description,
      jobSiteId: value.jobSiteId,
      priority: value.priority,
      status: value.status,
      dueDate: value.dueDate,
      assignedTo: value.assignedTo,
      completedAt:
        value.status === ActionStatus.COMPLETED
          ? (existing.completedAt ?? new Date())
          : null,
    },
  });
  return { id };
}

/**
 * Permanently delete an action within the viewer's scope. Returns false if the
 * action is not in scope. Deleting an action just removes its row (any audit
 * finding it was raised from is untouched — the link is on the action side).
 */
export async function deleteAction(
  viewer: PlatformViewer,
  id: string,
): Promise<boolean> {
  const existing = await getActionForViewer(viewer, id);
  if (!existing) return false;
  await prisma.action.delete({ where: { id } });
  return true;
}

/** Quick status change (open / in progress / complete) within scope. */
export async function setActionStatus(
  viewer: PlatformViewer,
  id: string,
  status: ActionStatus,
): Promise<boolean> {
  const existing = await getActionForViewer(viewer, id);
  if (!existing) return false;
  await prisma.action.update({
    where: { id },
    data: {
      status,
      completedAt:
        status === ActionStatus.COMPLETED
          ? (existing.completedAt ?? new Date())
          : null,
    },
  });
  return true;
}

/**
 * Generate an action from an audit finding (findings → actions integration).
 * The finding's audit must be in the viewer's scope. The new action is prefilled
 * from the finding (title, corrective action / description, site, priority from
 * severity, due date) and linked back to it. Returns null if out of scope.
 */
export async function createActionFromFinding(
  viewer: PlatformViewer,
  findingId: string,
): Promise<{ id: string } | null> {
  if (viewer.siteIds.length === 0) return null;
  const finding = await prisma.auditFinding.findFirst({
    where: { id: findingId, audit: { jobSiteId: { in: viewer.siteIds } } },
    include: { audit: { select: { jobSiteId: true } } },
  });
  if (!finding) return null;

  const created = await prisma.action.create({
    data: {
      title: finding.title,
      description: finding.correctiveAction ?? finding.description,
      jobSiteId: finding.audit.jobSiteId,
      priority: finding.severity as unknown as ActionPriority, // same LOW/MEDIUM/HIGH/CRITICAL scale
      status: ActionStatus.OPEN,
      dueDate: finding.dueDate,
      auditFindingId: finding.id,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
    },
    select: { id: true },
  });
  return created;
}
