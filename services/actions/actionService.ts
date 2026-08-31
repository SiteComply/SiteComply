import {
  ActionActivityType,
  ActionPriority,
  ActionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  resolveAssignee,
  type AssigneeKind,
} from '@/services/actions/actionAssigneeService';
import {
  notifyAssigned,
  notifyMeaningfulChange,
  type ActionSnapshot,
} from '@/services/notifications/notificationEventService';
import { zonedMidnightToUtc } from '@/lib/datetime';
import { viewerSiteIdsFor } from '@/services/platformUsers/effectivePermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isActionPriority,
  isActionStatus,
  isActionBucket,
  ACTION_TITLE_MAX,
  ACTION_DESCRIPTION_MAX,
  ACTION_ASSIGNEE_MAX,
  ACTION_NOTE_MAX,
  type ActionBucket,
} from '@/services/actions/actionConstants';

/** Result of a mutation that can fail on scope or a required completion note. */
export type ActionMutation =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'not_found' | 'note_required' | 'invalid_assignee';
    };

/** Build an activity row for the given author (used inside transactions). */
function activityRow(
  viewer: PlatformViewer,
  type: ActionActivityType,
  fields: {
    note?: string | null;
    fromValue?: string | null;
    toValue?: string | null;
  } = {},
) {
  return {
    type,
    note: fields.note ?? null,
    fromValue: fields.fromValue ?? null,
    toValue: fields.toValue ?? null,
    authorUserId: viewer.id,
    authorName: viewer.name,
  };
}

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
  // SC-015: the chosen assignee. `assigneeKind` is WORKER | PLATFORM_USER.
  assigneeKind?: string;
  assigneeId?: string;
}

export interface ValidatedAction {
  title: string;
  description: string | null;
  jobSiteId: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate: Date | null;
  assignedTo: string | null;
  assigneeKind: 'WORKER' | 'PLATFORM_USER' | null;
  assigneeId: string | null;
}

export type ActionFieldErrors = Partial<Record<keyof ActionInput, string>>;

/**
 * SC-015: `mode` decides whether an assignee is REQUIRED. It is mandatory when
 * CREATING an action, but never forced on an edit — legacy actions predate the
 * rule and must stay editable without inventing an assignee for them.
 */
export function validateAction(
  input: ActionInput,
  viewer: PlatformViewer,
  mode: 'create' | 'edit' = 'edit',
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

  // SC-015: a new action must name a responsible person. The identity is
  // re-checked against the site's assignable people in createAction — this only
  // establishes that something was chosen.
  const assigneeKind = text(input.assigneeKind);
  const assigneeId = text(input.assigneeId);
  if (mode === 'create') {
    if (
      !assigneeId ||
      (assigneeKind !== 'WORKER' && assigneeKind !== 'PLATFORM_USER')
    ) {
      errors.assignedTo = 'Please choose who is responsible for this action.';
    }
  } else if (
    assigneeId &&
    assigneeKind !== 'WORKER' &&
    assigneeKind !== 'PLATFORM_USER'
  ) {
    errors.assignedTo = 'Please choose who is responsible for this action.';
  }

  const jobSiteId = text(input.jobSiteId);
  if (!jobSiteId) errors.jobSiteId = 'Please choose a site.';
  else if (!viewer.siteIds.includes(jobSiteId))
    errors.jobSiteId = 'That site is not in your access.';

  const priority = text(input.priority) || 'MEDIUM';
  if (!isActionPriority(priority))
    errors.priority = 'Please choose a priority.';

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
      assigneeKind:
        assigneeKind === 'WORKER' || assigneeKind === 'PLATFORM_USER'
          ? assigneeKind
          : null,
      assigneeId: assigneeId || null,
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
  /**
   * Outstanding only = not completed (Open or In progress, which includes
   * overdue). Ignored when an explicit `bucket` already constrains status.
   */
  outstanding?: boolean;
  /** Free-text search over title, description and assignee. */
  search?: string;
  /** Pagination (omit for the full list). */
  skip?: number;
  take?: number;
}

/** Shared site-scoped where clause for listActions + countActions. Null → no sites. */
function actionWhere(
  viewer: PlatformViewer,
  filters: ActionListFilters,
  now: Date,
): Prisma.ActionWhereInput | null {
  // SC-022: the module's OWN access boundary, not the viewer's whole site list.
  // A contractor narrowed out of actions on one site keeps their other sites,
  // and the exclusion happens in the query rather than being filtered out after
  // the rows have already been read.
  const scoped = viewerSiteIdsFor(viewer, 'actions');
  const siteIds =
    filters.siteId && scoped.includes(filters.siteId)
      ? [filters.siteId]
      : scoped;
  if (siteIds.length === 0) return null;

  const bucket =
    filters.bucket && isActionBucket(filters.bucket)
      ? (filters.bucket as ActionBucket)
      : undefined;
  const where = bucketWhere(siteIds, bucket, now);
  if (filters.outstanding && !bucket) {
    where.status = { in: ['OPEN', 'IN_PROGRESS'] };
  }
  if (filters.priority && isActionPriority(filters.priority))
    where.priority = filters.priority as ActionPriority;

  const q = (filters.search ?? '').trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { assignedTo: { contains: q, mode: 'insensitive' } },
      // SC-015: the assignee is now a real person, so search their employer too
      // (the name itself is already covered by the assignedTo snapshot).
      { assignedToCompany: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

/** Count of actions matching the (scoped) filters — for pagination totals. */
export async function countActions(
  viewer: PlatformViewer,
  filters: ActionListFilters = {},
  now: Date = new Date(),
): Promise<number> {
  const where = actionWhere(viewer, filters, now);
  if (!where) return 0;
  return prisma.action.count({ where });
}

const ACTION_LIST_SELECT = {
  id: true,
  title: true,
  priority: true,
  status: true,
  dueDate: true,
  assignedTo: true,
  assignedToCompany: true,
  auditFindingId: true,
  createdAt: true,
  jobSite: { select: { id: true, name: true, jobReference: true } },
} satisfies Prisma.ActionSelect;

/** Site-scoped list of actions. Overdue first, then by due date, then newest. */
export async function listActions(
  viewer: PlatformViewer,
  filters: ActionListFilters = {},
  now: Date = new Date(),
) {
  const where = actionWhere(viewer, filters, now);
  if (!where) return [];

  return prisma.action.findMany({
    where,
    // A UNIQUE TIEBREAKER, NOT TIDINESS. Every key above can tie, so without a
    // unique last key Postgres may return tied rows in any order and may choose
    // differently on each query. With skip/take paging that means a row can
    // appear on two pages while another appears on none — invisible on page one
    // and only under paging. Ties are not rare here: rows created together in
    // one transaction share createdAt exactly.
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    skip: filters.skip,
    take: filters.take,
    select: ACTION_LIST_SELECT,
  });
}

/**
 * Outstanding (not-completed) actions for a single site, ordered for operational
 * focus: most urgent first (overdue / soonest due, undated last), then by
 * priority (Critical → Low), then newest. Powers the Site Details panel; the
 * usual RBAC + site-scoping is enforced via `actionWhere` (returns [] if the
 * site is out of scope). Completed actions are intentionally excluded — they stay
 * reachable via the Actions register.
 */
export async function listOutstandingActionsForSite(
  viewer: PlatformViewer,
  siteId: string,
  take: number,
  now: Date = new Date(),
) {
  const where = actionWhere(viewer, { siteId, outstanding: true }, now);
  if (!where) return [];

  return prisma.action.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take,
    select: ACTION_LIST_SELECT,
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
      where: {
        ...site,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { lt: now },
      },
    }),
    prisma.action.count({ where: { ...site, status: 'COMPLETED' } }),
  ]);
  return {
    OPEN: open,
    IN_PROGRESS: inProgress,
    OVERDUE: overdue,
    COMPLETED: completed,
  };
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
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // SC-015: resolve the chosen person against the site's ASSIGNABLE list. The
  // dropdown is a convenience; this is the authoritative check, so a crafted
  // request cannot assign an action to someone not inducted on that site.
  const assignee = await resolveAssignee(
    viewer,
    value.jobSiteId,
    value.assigneeKind as AssigneeKind,
    value.assigneeId ?? '',
  );
  if (!assignee) {
    return {
      ok: false,
      error: 'That person cannot be assigned actions on the selected site.',
    };
  }

  // Seed the timeline: a CREATED entry, and an ASSIGNMENT entry naming the person.
  const activities = [activityRow(viewer, ActionActivityType.CREATED)];
  activities.push(
    activityRow(viewer, ActionActivityType.ASSIGNMENT, {
      toValue: assignee.assignedTo,
    }),
  );

  const created = await prisma.action.create({
    data: {
      title: value.title,
      description: value.description,
      jobSiteId: value.jobSiteId,
      priority: value.priority,
      status: value.status,
      dueDate: value.dueDate,
      assignedTo: assignee.assignedTo,
      assignedToCompany: assignee.assignedToCompany,
      assignedWorkerId: assignee.assignedWorkerId,
      assignedPlatformUserId: assignee.assignedPlatformUserId,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      completedAt: value.status === ActionStatus.COMPLETED ? new Date() : null,
      activities: { create: activities },
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      dueDate: true,
      assignedPlatformUserId: true,
      jobSite: { select: { name: true } },
    },
  });

  // SC-016: tell the assignee they now own this.
  await notifyAssigned(toSnapshot(created), viewer);

  return { ok: true, id: created.id };
}

/** Shape an action row for the SC-016 notification payload. */
function toSnapshot(a: {
  id: string;
  title: string;
  description: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate: Date | null;
  assignedPlatformUserId: string | null;
  jobSite: { name: string };
}): ActionSnapshot {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    priority: a.priority,
    status: a.status,
    dueDate: a.dueDate,
    siteName: a.jobSite.name,
    assignedPlatformUserId: a.assignedPlatformUserId,
  };
}

export async function updateAction(
  viewer: PlatformViewer,
  id: string,
  value: ValidatedAction,
  completionNote?: string,
): Promise<ActionMutation> {
  const existing = await getActionForViewer(viewer, id);
  if (!existing) return { ok: false, reason: 'not_found' };

  const statusChanged = value.status !== existing.status;
  const completing =
    value.status === ActionStatus.COMPLETED &&
    existing.status !== ActionStatus.COMPLETED;
  const note = (completionNote ?? '').trim();
  // A completion note is required when transitioning TO completed.
  if (completing && note === '') return { ok: false, reason: 'note_required' };

  // SC-015: an edit only changes the assignee when a person was actually chosen.
  // Legacy actions (free-text or unassigned) are left untouched — the mandatory
  // rule applies to newly created actions only.
  let assignee: Awaited<ReturnType<typeof resolveAssignee>> = null;
  if (value.assigneeId && value.assigneeKind) {
    assignee = await resolveAssignee(
      viewer,
      value.jobSiteId,
      value.assigneeKind,
      value.assigneeId,
    );
    if (!assignee) {
      return { ok: false, reason: 'invalid_assignee' };
    }
  }
  const nextAssignedTo = assignee ? assignee.assignedTo : existing.assignedTo;
  const assigneeChanged =
    (nextAssignedTo ?? null) !== (existing.assignedTo ?? null);

  const activities = [];
  if (statusChanged)
    activities.push(
      activityRow(viewer, ActionActivityType.STATUS_CHANGE, {
        fromValue: existing.status,
        toValue: value.status,
        note: completing ? note : null,
      }),
    );
  if (assigneeChanged)
    activities.push(
      activityRow(viewer, ActionActivityType.ASSIGNMENT, {
        fromValue: existing.assignedTo,
        toValue: nextAssignedTo,
      }),
    );

  await prisma.action.update({
    where: { id },
    data: {
      title: value.title,
      description: value.description,
      jobSiteId: value.jobSiteId,
      priority: value.priority,
      status: value.status,
      dueDate: value.dueDate,
      ...(assignee
        ? {
            assignedTo: assignee.assignedTo,
            assignedToCompany: assignee.assignedToCompany,
            assignedWorkerId: assignee.assignedWorkerId,
            assignedPlatformUserId: assignee.assignedPlatformUserId,
          }
        : {}),
      completedAt:
        value.status === ActionStatus.COMPLETED
          ? (existing.completedAt ?? new Date())
          : null,
      completionNote:
        value.status === ActionStatus.COMPLETED
          ? completing
            ? note
            : existing.completionNote
          : null,
      ...(activities.length ? { activities: { create: activities } } : {}),
    },
  });

  // SC-016: notify the assignee. A NEW assignee is told they now own it;
  // otherwise the current assignee is told only about MEANINGFUL changes
  // (status, priority, due date) — never about a description or title tweak.
  const updatedRow = await prisma.action.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      dueDate: true,
      assignedPlatformUserId: true,
      jobSite: { select: { name: true } },
    },
  });
  if (updatedRow) {
    const snapshot = toSnapshot(updatedRow);
    if (assignee) {
      await notifyAssigned(snapshot, viewer, true);
    }
    await notifyMeaningfulChange(
      {
        status: existing.status,
        priority: existing.priority,
        dueDate: existing.dueDate,
      },
      snapshot,
      viewer,
    );
  }

  return { ok: true, id };
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

/**
 * Quick status change (open / in progress / complete) within scope. Requires a
 * completion note when moving TO completed; records a STATUS_CHANGE activity.
 */
export async function setActionStatus(
  viewer: PlatformViewer,
  id: string,
  status: ActionStatus,
  completionNote?: string,
): Promise<ActionMutation> {
  const existing = await getActionForViewer(viewer, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (status === existing.status) return { ok: true, id };

  const completing =
    status === ActionStatus.COMPLETED &&
    existing.status !== ActionStatus.COMPLETED;
  const note = (completionNote ?? '').trim();
  if (completing && note === '') return { ok: false, reason: 'note_required' };

  await prisma.action.update({
    where: { id },
    data: {
      status,
      completedAt:
        status === ActionStatus.COMPLETED
          ? (existing.completedAt ?? new Date())
          : null,
      completionNote: status === ActionStatus.COMPLETED ? note : null,
      activities: {
        create: [
          activityRow(viewer, ActionActivityType.STATUS_CHANGE, {
            fromValue: existing.status,
            toValue: status,
            note: completing ? note : null,
          }),
        ],
      },
    },
  });

  // SC-016: a status change is a meaningful change, so the assignee is told —
  // this is the quick status control, a separate path from the edit form.
  const row = await prisma.action.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      dueDate: true,
      assignedPlatformUserId: true,
      jobSite: { select: { name: true } },
    },
  });
  if (row) {
    await notifyMeaningfulChange(
      {
        status: existing.status,
        priority: existing.priority,
        dueDate: existing.dueDate,
      },
      toSnapshot(row),
      viewer,
    );
  }

  return { ok: true, id };
}

/** Add a comment (an update) to an action's timeline. Returns false if out of scope. */
export async function addActionComment(
  viewer: PlatformViewer,
  id: string,
  body: string,
): Promise<
  { ok: true } | { ok: false; reason: 'not_found' | 'empty' | 'too_long' }
> {
  const text = (body ?? '').trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (text.length > ACTION_NOTE_MAX) return { ok: false, reason: 'too_long' };

  const existing = await getActionForViewer(viewer, id);
  if (!existing) return { ok: false, reason: 'not_found' };

  await prisma.actionActivity.create({
    data: {
      actionId: id,
      ...activityRow(viewer, ActionActivityType.COMMENT, { note: text }),
    },
  });
  return { ok: true };
}

/** Chronological activity timeline for an action (oldest first). */
export function listActionActivities(actionId: string) {
  return prisma.actionActivity.findMany({
    where: { actionId },
    orderBy: { createdAt: 'asc' },
  });
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
  assignee: { kind: AssigneeKind; id: string },
): Promise<
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'invalid_assignee' }
> {
  if (viewer.siteIds.length === 0) return { ok: false, reason: 'not_found' };
  const finding = await prisma.auditFinding.findFirst({
    where: { id: findingId, audit: { jobSiteId: { in: viewer.siteIds } } },
    include: { audit: { select: { jobSiteId: true } } },
  });
  if (!finding) return { ok: false, reason: 'not_found' };

  // SC-015: findings→actions is the main generator of actions now that SC-013/
  // SC-014 are live, so this path must satisfy the mandatory-assignee rule too —
  // otherwise it would quietly create the unassigned actions the rule forbids.
  const resolved = await resolveAssignee(
    viewer,
    finding.audit.jobSiteId,
    assignee.kind,
    assignee.id,
  );
  if (!resolved) return { ok: false, reason: 'invalid_assignee' };

  const created = await prisma.action.create({
    data: {
      title: finding.title,
      description: finding.correctiveAction ?? finding.description,
      jobSiteId: finding.audit.jobSiteId,
      priority: finding.severity as unknown as ActionPriority, // same LOW/MEDIUM/HIGH/CRITICAL scale
      status: ActionStatus.OPEN,
      dueDate: finding.dueDate,
      auditFindingId: finding.id,
      assignedTo: resolved.assignedTo,
      assignedToCompany: resolved.assignedToCompany,
      assignedWorkerId: resolved.assignedWorkerId,
      assignedPlatformUserId: resolved.assignedPlatformUserId,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      activities: {
        create: [
          activityRow(viewer, ActionActivityType.CREATED),
          activityRow(viewer, ActionActivityType.ASSIGNMENT, {
            toValue: resolved.assignedTo,
          }),
        ],
      },
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      dueDate: true,
      assignedPlatformUserId: true,
      jobSite: { select: { name: true } },
    },
  });

  // SC-016: audit findings are the main generator of actions now SC-013/SC-014
  // are live, so this path notifies the assignee like any other.
  await notifyAssigned(toSnapshot(created), viewer);

  return { ok: true, id: created.id };
}
