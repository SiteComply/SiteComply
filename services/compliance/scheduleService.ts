import {
  PlatformRole,
  ScheduleAssigneeKind,
  ScheduleFrequency,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isActivityTypeAvailable } from '@/services/siteServices/siteServiceAvailability';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import { resolveAssignee } from '@/services/actions/actionAssigneeService';
import {
  isAssigneeKind,
  isFrequency,
  isTimeOfDay,
} from '@/services/compliance/complianceConstants';

/**
 * SC-020 Phase 1 — recurring compliance schedules.
 *
 * Ownership follows the approved decision: SITE MANAGERS own schedules for their
 * sites, DIRECTORS see across all sites. Both already hold audits create/edit
 * after the SC-013 follow-up, so this needs NO RBAC matrix change — view is
 * `audits:view`, managing is `audits:create` / `audits:edit`, and every query is
 * scoped to the viewer's sites.
 *
 * Assignment supports an INDIVIDUAL or a ROLE. Individuals reuse SC-015's
 * assignable-people resolution (so a worker must actually be inducted on the
 * site); a role resolves to whoever holds it on that site at the time, which is
 * what the REV-1 example's "Assigned to Fire Marshal" implies.
 */

export type ScheduleResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

export interface ScheduleInput {
  jobSiteId: string;
  auditTemplateId: string;
  title?: string;
  frequency: string;
  intervalDays?: number | null;
  weekdays?: number[];
  dayOfMonth?: number | null;
  timeOfDay: string;
  startDate: string;
  endDate?: string | null;
  dueWindowDays?: number;
  assigneeKind: string;
  assigneeId?: string | null;
  assignedRole?: string | null;
  reminderOffsetsDays?: number[];
  escalateAfterDays?: number | null;
  escalateToRole?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRole(v: string): v is PlatformRole {
  return Object.keys(PlatformRole).includes(v);
}

/** Human label for an occurrence's assignee — "John Smith" or "Fire Marshal". */
export function assigneeLabel(
  kind: ScheduleAssigneeKind,
  role: PlatformRole | null,
  personName: string | null,
): string {
  if (kind === ScheduleAssigneeKind.ROLE && role) {
    return ROLE_LABELS[role] ?? role;
  }
  return personName ?? 'Unassigned';
}

export async function listSchedules(viewer: PlatformViewer, siteId?: string) {
  if (!permits(viewer.role, 'audits', 'view')) return [];
  const siteIds =
    siteId && viewer.siteIds.includes(siteId) ? [siteId] : viewer.siteIds;
  if (siteIds.length === 0) return [];
  return prisma.complianceSchedule.findMany({
    where: { jobSiteId: { in: siteIds } },
    orderBy: [{ active: 'desc' }, { title: 'asc' }],
    include: {
      auditTemplate: { select: { id: true, name: true } },
      jobSite: { select: { id: true, name: true } },
      _count: { select: { occurrences: true } },
    },
  });
}

/**
 * Validate and create a schedule. Validation is deliberately strict about the
 * frequency's own fields: a WEEKLY schedule with no weekdays, or a CUSTOM one
 * with no interval, would silently generate the wrong cadence.
 */
export async function createSchedule(
  viewer: PlatformViewer,
  input: ScheduleInput,
): Promise<ScheduleResult> {
  if (!permits(viewer.role, 'audits', 'create')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(input.jobSiteId)) {
    return { ok: false, reason: 'not_found' };
  }

  const invalid = (error: string): ScheduleResult => ({
    ok: false,
    reason: 'invalid',
    error,
  });

  if (!isFrequency(input.frequency)) return invalid('Choose a frequency.');
  if (!isTimeOfDay(input.timeOfDay)) return invalid('Enter a valid time.');
  if (!DATE_RE.test(input.startDate)) return invalid('Enter a start date.');
  if (input.endDate && !DATE_RE.test(input.endDate)) {
    return invalid('Enter a valid end date.');
  }
  if (input.endDate && input.endDate < input.startDate) {
    return invalid('The end date cannot be before the start date.');
  }

  const weekdays = (input.weekdays ?? []).filter((d) => d >= 1 && d <= 7);
  if (input.frequency === 'WEEKLY' && weekdays.length === 0) {
    return invalid('Choose at least one day of the week.');
  }
  if (input.frequency === 'CUSTOM') {
    const n = input.intervalDays ?? 0;
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return invalid('Repeat every 1 to 365 days.');
    }
  }
  if (input.frequency === 'MONTHLY') {
    const d = input.dayOfMonth ?? 0;
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return invalid('Choose a day of the month between 1 and 31.');
    }
  }

  const template = await prisma.auditTemplate.findFirst({
    where: { id: input.auditTemplateId, active: true },
    select: { id: true, name: true },
  });
  if (!template) return invalid('Choose an activity type.');

  // SC-021 — SERVER-SIDE ENFORCEMENT. The activity-type picker already hides
  // types this site has switched off; re-checked here because the id is
  // postable. Named in the message: "not available" without saying what would
  // leave the manager guessing which of their choices was wrong.
  if (!(await isActivityTypeAvailable(input.jobSiteId, template.id))) {
    return invalid(
      `“${template.name}” is not available for this site. Turn it on in the site’s services configuration first.`,
    );
  }

  if (!isAssigneeKind(input.assigneeKind))
    return invalid('Choose who is responsible.');

  let assignedPlatformUserId: string | null = null;
  let assignedWorkerId: string | null = null;
  let assignedRole: PlatformRole | null = null;

  if (input.assigneeKind === 'ROLE') {
    const role = input.assignedRole ?? '';
    if (!isRole(role)) return invalid('Choose a role to assign to.');
    assignedRole = role;
  } else {
    const id = (input.assigneeId ?? '').trim();
    if (!id) return invalid('Choose who is responsible.');
    if (input.assigneeKind === 'WORKER') {
      // A worker must genuinely be inducted on the site — SC-015's rule, which
      // is the right one for someone who has to be on site to do the work.
      const resolved = await resolveAssignee(
        viewer,
        input.jobSiteId,
        'WORKER',
        id,
      );
      if (!resolved) {
        return invalid(
          'That worker is not inducted on this site, so cannot be assigned activities there.',
        );
      }
      assignedWorkerId = resolved.assignedWorkerId;
    } else {
      // A PLATFORM USER is validated directly against site assignment, NOT via
      // SC-015's assignable-people list. That list only offers platform users as
      // a FALLBACK when a site has no inducted workers — correct for actions,
      // but wrong here: assigning a recurring inspection to a site manager is
      // the primary case, and on any real site with inducted workers the
      // fallback would never include them.
      const user = await prisma.platformUser.findFirst({
        where: {
          id,
          status: 'ACTIVE',
          assignedSites: { some: { id: input.jobSiteId } },
        },
        select: { id: true },
      });
      if (!user) {
        return invalid(
          'That user is not an active platform user assigned to this site.',
        );
      }
      assignedPlatformUserId = user.id;
    }
  }

  const escalateToRole =
    input.escalateToRole && isRole(input.escalateToRole)
      ? input.escalateToRole
      : null;

  const created = await prisma.complianceSchedule.create({
    data: {
      jobSiteId: input.jobSiteId,
      auditTemplateId: template.id,
      title: (input.title ?? '').trim() || template.name,
      frequency: input.frequency as ScheduleFrequency,
      intervalDays:
        input.frequency === 'CUSTOM' ? (input.intervalDays ?? null) : null,
      weekdays:
        input.frequency === 'WEEKLY' || input.frequency === 'DAILY'
          ? weekdays
          : [],
      dayOfMonth:
        input.frequency === 'MONTHLY' ? (input.dayOfMonth ?? null) : null,
      timeOfDay: input.timeOfDay,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: input.endDate
        ? new Date(`${input.endDate}T23:59:59.999Z`)
        : null,
      dueWindowDays: Math.max(0, Math.min(90, input.dueWindowDays ?? 1)),
      assigneeKind: input.assigneeKind as ScheduleAssigneeKind,
      assignedPlatformUserId,
      assignedWorkerId,
      assignedRole,
      reminderOffsetsDays: (input.reminderOffsetsDays ?? []).filter(
        (n) => n >= 0 && n <= 60,
      ),
      escalateAfterDays: input.escalateAfterDays ?? null,
      escalateToRole,
      // Activation-forward generation is anchored here.
      activatedAt: new Date(),
      createdByUserId: viewer.id,
      createdByName: viewer.name,
    },
    select: { id: true },
  });

  return { ok: true, id: created.id };
}

/** Pause or resume a schedule. Pausing stops future generation, keeps history. */
export async function setScheduleActive(
  viewer: PlatformViewer,
  scheduleId: string,
  active: boolean,
): Promise<ScheduleResult> {
  if (!permits(viewer.role, 'audits', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (viewer.siteIds.length === 0) return { ok: false, reason: 'not_found' };
  const existing = await prisma.complianceSchedule.findFirst({
    where: { id: scheduleId, jobSiteId: { in: viewer.siteIds } },
    select: {
      id: true,
      jobSiteId: true,
      auditTemplateId: true,
      auditTemplate: { select: { name: true } },
    },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  // SC-021: RE-ACTIVATION is a creation-shaped act and gets the same check.
  // Without this, a schedule paused before its type was switched off could be
  // resumed afterwards and quietly start generating an inspection the site has
  // declared irrelevant. Deactivating is never blocked.
  if (
    active &&
    !(await isActivityTypeAvailable(
      existing.jobSiteId,
      existing.auditTemplateId,
    ))
  ) {
    return {
      ok: false,
      reason: 'invalid',
      error: `“${existing.auditTemplate.name}” is no longer available for this site, so this schedule cannot be reactivated. Turn the inspection type back on in the site’s services configuration first.`,
    };
  }

  await prisma.complianceSchedule.update({
    where: { id: scheduleId },
    data: {
      active,
      // Re-activating re-anchors activation, so a paused schedule never
      // backfills the gap it was paused for.
      ...(active ? { activatedAt: new Date() } : {}),
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
  });
  return { ok: true, id: scheduleId };
}
