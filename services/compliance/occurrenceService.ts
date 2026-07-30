import { OccurrenceStatus, ScheduleAssigneeKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { createAudit } from '@/services/audits/auditService';
import { assigneeLabel } from '@/services/compliance/scheduleService';
import {
  addDays,
  ensureOccurrences,
  londonDateStr,
} from '@/services/compliance/occurrenceGenerator';
import { recordEscalations } from '@/services/compliance/complianceNotifications';

/**
 * SC-020 Phase 1 — reading and progressing generated occurrences.
 *
 * Every read calls ensureOccurrences first, so the calendar is correct whenever
 * it is looked at without any scheduler existing yet. Phase 4's timer will call
 * the same generator; this is not a stopgap that gets thrown away.
 */

export interface CalendarOccurrence {
  id: string;
  scheduleId: string;
  templateId: string;
  title: string;
  dueDateLocal: string;
  timeOfDay: string;
  status: OccurrenceStatus;
  siteId: string;
  siteName: string;
  assigneeLabel: string;
  auditId: string | null;
  overdue: boolean;
  /** SC-020 Phase 2 — set once escalated, drives the calendar's marker. */
  escalatedAt: string | null;
  escalatedToRole: string | null;
  /** True when the assignee is a worker, who cannot yet be notified. */
  workerNotNotified: boolean;
}

const OCCURRENCE_INCLUDE = {
  schedule: {
    select: {
      id: true,
      title: true,
      auditTemplateId: true,
      auditTemplate: { select: { id: true, name: true } },
    },
  },
  jobSite: { select: { id: true, name: true } },
} as const;

type Row = Awaited<
  ReturnType<
    typeof prisma.complianceOccurrence.findMany<{
      include: typeof OCCURRENCE_INCLUDE;
    }>
  >
>[number];

async function toView(
  rows: Row[],
  todayLocal: string,
): Promise<CalendarOccurrence[]> {
  // Resolve individual assignee names in one pass rather than per row.
  const userIds = [
    ...new Set(rows.map((r) => r.assignedPlatformUserId).filter(Boolean)),
  ] as string[];
  const workerIds = [
    ...new Set(rows.map((r) => r.assignedWorkerId).filter(Boolean)),
  ] as string[];
  const [users, workers] = await Promise.all([
    userIds.length
      ? prisma.platformUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    workerIds.length
      ? prisma.worker.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const workerName = new Map(workers.map((w) => [w.id, w.fullName]));

  return rows.map((r) => {
    const person =
      r.assigneeKind === ScheduleAssigneeKind.USER
        ? (userName.get(r.assignedPlatformUserId ?? '') ?? null)
        : r.assigneeKind === ScheduleAssigneeKind.WORKER
          ? (workerName.get(r.assignedWorkerId ?? '') ?? null)
          : null;
    return {
      id: r.id,
      scheduleId: r.scheduleId,
      templateId: r.schedule.auditTemplateId,
      title: r.schedule.title || r.schedule.auditTemplate.name,
      dueDateLocal: r.dueDateLocal,
      timeOfDay: r.timeOfDay,
      status: r.status,
      siteId: r.jobSite.id,
      siteName: r.jobSite.name,
      assigneeLabel: assigneeLabel(r.assigneeKind, r.assignedRole, person),
      auditId: r.auditId,
      // Derived, never stored — the same rule the Actions register uses.
      overdue:
        r.status !== OccurrenceStatus.COMPLETED && r.dueDateLocal < todayLocal,
      escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : null,
      escalatedToRole: r.escalatedToRole ?? null,
      // A worker assignee gets no notification (SC-016 recipients are platform
      // users), so the calendar says so plainly rather than implying someone was
      // told.
      workerNotNotified: r.assigneeKind === ScheduleAssigneeKind.WORKER,
    };
  });
}

/** Occurrences for a local date window, generating any that are missing first. */
export async function getCalendarWindow(
  viewer: PlatformViewer,
  fromLocal: string,
  toLocal: string,
  siteId?: string,
): Promise<{ occurrences: CalendarOccurrence[]; generated: number }> {
  if (!permits(viewer.role, 'audits', 'view')) {
    return { occurrences: [], generated: 0 };
  }
  const siteIds =
    siteId && viewer.siteIds.includes(siteId) ? [siteId] : viewer.siteIds;
  if (siteIds.length === 0) return { occurrences: [], generated: 0 };

  const { created } = await ensureOccurrences(siteIds, fromLocal, toLocal);
  // SC-020 Phase 2: escalate anything now overdue past its threshold. Idempotent
  // (guarded by escalatedAt), so running it on every calendar read is safe — and
  // until Phase 4's timer this read IS the trigger.
  await recordEscalations(siteIds);

  const rows = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: siteIds },
      dueDateLocal: { gte: fromLocal, lte: toLocal },
    },
    orderBy: [{ dueDateLocal: 'asc' }, { timeOfDay: 'asc' }],
    include: OCCURRENCE_INCLUDE,
  });

  return {
    occurrences: await toView(rows, londonDateStr(new Date())),
    generated: created,
  };
}

/** The "Upcoming (Next 7 Days)" panel from the REV-1 example. */
export async function getUpcoming(
  viewer: PlatformViewer,
  siteId?: string,
  days = 7,
): Promise<CalendarOccurrence[]> {
  const today = londonDateStr(new Date());
  const { occurrences } = await getCalendarWindow(
    viewer,
    today,
    addDays(today, days),
    siteId,
  );
  return occurrences
    .filter((o) => o.status !== OccurrenceStatus.COMPLETED)
    .slice(0, 25);
}

/** Distinct activity types present in a window — drives the legend. */
export function activityTypesIn(
  occurrences: CalendarOccurrence[],
): { templateId: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const o of occurrences) {
    if (!seen.has(o.templateId)) seen.set(o.templateId, o.title);
  }
  return [...seen.entries()]
    .map(([templateId, title]) => ({ templateId, title }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en-GB'));
}

export type OccurrenceResult =
  | { ok: true; auditId?: string }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * Start an occurrence: create a real audit from the schedule's template and link
 * it. This is the join to SC-013 (template provenance) and SC-014 (scoring) —
 * a scheduled inspection becomes an ordinary audit, so findings, actions and
 * compliance scoring all work with no special cases.
 */
export async function startOccurrence(
  viewer: PlatformViewer,
  occurrenceId: string,
): Promise<OccurrenceResult> {
  if (!permits(viewer.role, 'audits', 'create')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (viewer.siteIds.length === 0) return { ok: false, reason: 'not_found' };

  const occ = await prisma.complianceOccurrence.findFirst({
    where: { id: occurrenceId, jobSiteId: { in: viewer.siteIds } },
    include: {
      schedule: { select: { title: true, auditTemplateId: true } },
      jobSite: { select: { id: true } },
    },
  });
  if (!occ) return { ok: false, reason: 'not_found' };
  if (occ.auditId) return { ok: true, auditId: occ.auditId };

  const created = await createAudit(viewer, {
    title: `${occ.schedule.title} — ${occ.dueDateLocal}`,
    description: null,
    observations: null,
    overallScore: null,
    jobSiteId: occ.jobSiteId,
    documentIds: [],
    templateId: occ.schedule.auditTemplateId,
  } as never);
  if (!created.ok) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Could not create the audit.',
    };
  }

  await prisma.complianceOccurrence.update({
    where: { id: occ.id },
    data: { auditId: created.id, status: OccurrenceStatus.IN_PROGRESS },
  });
  return { ok: true, auditId: created.id };
}

/** Mark an occurrence complete. Evidence lives on the linked audit. */
export async function completeOccurrence(
  viewer: PlatformViewer,
  occurrenceId: string,
): Promise<OccurrenceResult> {
  if (!permits(viewer.role, 'audits', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (viewer.siteIds.length === 0) return { ok: false, reason: 'not_found' };
  const occ = await prisma.complianceOccurrence.findFirst({
    where: { id: occurrenceId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!occ) return { ok: false, reason: 'not_found' };

  await prisma.complianceOccurrence.update({
    where: { id: occ.id },
    data: {
      status: OccurrenceStatus.COMPLETED,
      completedAt: new Date(),
      completedByName: viewer.name,
    },
  });
  return { ok: true };
}
