import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformViewerTypes';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import {
  buildClosureChecklist,
  warningSnapshot,
  type ClosureChecklist,
} from '@/services/projectClosure/closureChecklist';
import {
  invalidateClosedProjectCache,
  runProjectLifecycleWrite,
} from '@/services/projectClosure/projectWritable';

/**
 * SC-025 — closing and reopening a project.
 *
 * THE PERMISSION SPLIT IS DELIBERATE AND ASYMMETRIC. Site Managers and
 * Directors may close a project; only Directors may reopen one. Closing is an
 * operational act by the person who ran the job. Reopening unfreezes an audit
 * trail that a client may already have been handed, so it sits with the role
 * that answers for the record.
 *
 * Everything here is additive to history: closing suspends worker assignments
 * rather than deleting them, leaves every record in place, and writes an
 * append-only SiteClosureEvent. Nothing is ever removed by closing a project.
 */

/** Site Managers and Directors, per the approved decision. */
export const PROJECT_CLOSE_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'SITE_MANAGER',
];

/** Directors only — reopening unfreezes an audit trail. */
export const PROJECT_REOPEN_ROLES: PlatformRoleValue[] = ['DIRECTOR'];

export function canCloseProject(role: PlatformRoleValue): boolean {
  return PROJECT_CLOSE_ROLES.includes(role);
}

export function canReopenProject(role: PlatformRoleValue): boolean {
  return PROJECT_REOPEN_ROLES.includes(role);
}

export type ClosureFailure =
  | 'forbidden'
  | 'not_found'
  | 'blocked'
  | 'already_closed'
  | 'not_closed'
  | 'reason_required';

export type CloseResult =
  | { ok: true; suspendedAssignments: number; warnings: number }
  | { ok: false; reason: ClosureFailure; checklist?: ClosureChecklist };

export type ReopenResult =
  | { ok: true; restoredAssignments: number }
  | { ok: false; reason: ClosureFailure };

export interface ClosureEventView {
  id: string;
  action: string;
  reason: string | null;
  warnings: { key: string; label: string; count: number }[];
  actorName: string;
  createdAt: Date;
}

/**
 * Close a project.
 *
 * The checklist is rebuilt HERE rather than trusted from the client: a browser
 * that saw a clean checklist five minutes ago is not evidence that the site is
 * clear now, and someone could check in during that gap.
 */
export async function closeProject(
  viewer: PlatformViewer,
  siteId: string,
  input: { reason?: string; acknowledgedWarnings?: boolean },
): Promise<CloseResult> {
  if (!canCloseProject(viewer.role)) return { ok: false, reason: 'forbidden' };
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, status: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };
  if (site.status === 'COMPLETED')
    return { ok: false, reason: 'already_closed' };

  const checklist = await buildClosureChecklist(siteId);
  if (!checklist.canClose) {
    return { ok: false, reason: 'blocked', checklist };
  }

  // Suspending rather than removing: the record of who had access to this
  // project is part of its history, and REMOVED would read as a decision
  // someone made about that worker rather than a consequence of closure.
  const toSuspend = await prisma.workerSiteAssignment.findMany({
    where: { jobSiteId: siteId, status: { in: ['INVITED', 'ACTIVE'] } },
    select: { id: true },
  });
  const suspendIds = toSuspend.map((a) => a.id);

  const warnings = warningSnapshot(checklist.warnings);

  // Inside the lifecycle bypass: the site becomes COMPLETED partway through
  // this transaction, so without it the guard would reject the very writes that
  // implement closure.
  await runProjectLifecycleWrite(() =>
    prisma.$transaction([
      prisma.jobSite.update({
        where: { id: siteId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: viewer.id,
          completedByName: viewer.name,
        },
      }),
      prisma.workerSiteAssignment.updateMany({
        where: { id: { in: suspendIds } },
        data: { status: 'SUSPENDED' },
      }),
      // Scheduled work stops: deactivating the schedules means the SC-020 timer
      // generates nothing further, on top of the site-status filter it already
      // applies. Belt and braces, because a schedule reactivated later must not
      // quietly resume on a closed project.
      prisma.complianceSchedule.updateMany({
        where: { jobSiteId: siteId, active: true },
        data: { active: false },
      }),
      prisma.siteClosureEvent.create({
        data: {
          jobSiteId: siteId,
          action: 'CLOSED',
          reason: input.reason?.trim() || null,
          warnings,
          suspendedAssignmentIds: suspendIds,
          actorUserId: viewer.id,
          actorName: viewer.name,
        },
      }),
    ]),
  );

  // The guard caches completed ids for a second; drop it so the very next write
  // is refused rather than slipping through the tail of the old cache.
  invalidateClosedProjectCache();

  return {
    ok: true,
    suspendedAssignments: suspendIds.length,
    warnings: warnings.length,
  };
}

/**
 * Reopen a project.
 *
 * A reason is MANDATORY — the requirement asks for it, and "why was this
 * closed record made editable again" is the first question an auditor asks.
 * Access is restored to exactly the assignments this closure suspended, read
 * back from the closure event, rather than reactivating everything that
 * happens to be suspended (some were suspended by a manager, for cause, and
 * reopening a project is not a decision to undo that).
 */
export async function reopenProject(
  viewer: PlatformViewer,
  siteId: string,
  input: { reason?: string; restoreAssignments?: boolean },
): Promise<ReopenResult> {
  if (!canReopenProject(viewer.role)) return { ok: false, reason: 'forbidden' };
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const reason = (input.reason ?? '').trim();
  if (reason === '') return { ok: false, reason: 'reason_required' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, status: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };
  if (site.status !== 'COMPLETED') return { ok: false, reason: 'not_closed' };

  let restoreIds: string[] = [];
  if (input.restoreAssignments !== false) {
    const lastClosure = await prisma.siteClosureEvent.findFirst({
      where: { jobSiteId: siteId, action: 'CLOSED' },
      orderBy: { createdAt: 'desc' },
      select: { suspendedAssignmentIds: true },
    });
    const ids = lastClosure?.suspendedAssignmentIds;
    if (Array.isArray(ids)) {
      restoreIds = ids.filter((v): v is string => typeof v === 'string');
    }
  }

  await runProjectLifecycleWrite(() =>
    prisma.$transaction([
      prisma.jobSite.update({
        where: { id: siteId },
        data: {
          status: 'ACTIVE',
          completedAt: null,
          completedById: null,
          completedByName: null,
        },
      }),
      // Only those still SUSPENDED — one removed since closure stays removed.
      prisma.workerSiteAssignment.updateMany({
        where: { id: { in: restoreIds }, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      }),
      prisma.siteClosureEvent.create({
        data: {
          jobSiteId: siteId,
          action: 'REOPENED',
          reason,
          actorUserId: viewer.id,
          actorName: viewer.name,
        },
      }),
    ]),
  );

  invalidateClosedProjectCache();

  // Compliance schedules are deliberately NOT reactivated: they were stopped by
  // a decision, and silently resuming inspection generation on reopen would
  // raise work nobody asked for. The manager turns back on what they need.
  return { ok: true, restoredAssignments: restoreIds.length };
}

/** The closure/reopen history for a project, newest first. */
export async function listClosureEvents(
  viewer: PlatformViewer,
  siteId: string,
): Promise<ClosureEventView[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const rows = await prisma.siteClosureEvent.findMany({
    where: { jobSiteId: siteId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      reason: true,
      warnings: true,
      actorName: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    reason: r.reason,
    warnings: Array.isArray(r.warnings)
      ? (r.warnings as { key: string; label: string; count: number }[])
      : [],
    actorName: r.actorName,
    createdAt: r.createdAt,
  }));
}
