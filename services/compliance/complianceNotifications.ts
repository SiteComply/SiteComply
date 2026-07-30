import {
  NotificationEventType,
  OccurrenceStatus,
  PlatformRole,
  ScheduleAssigneeKind,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import type { RawNotification } from '@/services/notifications/notificationTypes';
import { isNotificationEnabled } from '@/services/notifications/notificationConfigService';
import { formatDateUK } from '@/lib/datetime';
import {
  daysBetween,
  londonDateStr,
} from '@/services/compliance/occurrenceGenerator';

/**
 * SC-020 Phase 2 — reminders and escalations for scheduled compliance activities.
 *
 * The split follows SC-016's own precedent, and it is the load-bearing decision:
 *
 *  - REMINDERS are DERIVED. "Due in 3 days" is a STATE, so it is computed on read.
 *    That needs no scheduler, self-corrects when a due date moves (a stored
 *    reminder would go stale and lie), and is idempotent by nature.
 *  - ESCALATIONS are STORED, as NotificationEvent rows. An escalation is a
 *    discrete act, and "was management actually told, and when" is precisely the
 *    question a stored record answers and a derived view never can.
 *
 * Volume is the real risk here: a daily activity across several sites, fanned out
 * to every holder of a role, could easily bury the bell. Hence digesting above a
 * threshold, one row per occurrence rather than per reminder offset, three
 * independent admin toggles, and a per-viewer cap.
 */

/** Above this many due/overdue items for one viewer, collapse to a digest row. */
export const DIGEST_THRESHOLD = 3;
/** Hard cap on compliance rows per viewer, mirroring SC-016's event window. */
const MAX_ROWS = 40;

const DUE_BADGE = 'bg-hivis-400/25 text-ink';
const OVERDUE_BADGE = 'bg-danger-50 text-danger-700';
const CALENDAR = '/platform/dashboard/compliance-calendar';

interface Candidate {
  id: string;
  title: string;
  siteName: string;
  dueDateLocal: string;
  timeOfDay: string;
  daysUntil: number;
  auditId: string | null;
}

/**
 * Occurrences addressed to this viewer that are due soon or overdue.
 *
 * Recipients follow the approved rules: an individual USER assignee is the
 * viewer themselves; a ROLE assignee reaches every active holder of that role on
 * the site. A WORKER assignee reaches nobody — SC-016's recipients are platform
 * users only — which is why the calendar labels those "assigned worker, not
 * notified" rather than quietly redirecting them to a manager and misattributing
 * responsibility.
 */
async function candidatesFor(
  viewer: PlatformViewer,
  now: Date,
): Promise<{ due: Candidate[]; overdue: Candidate[] }> {
  const today = londonDateStr(now);
  if (viewer.siteIds.length === 0) return { due: [], overdue: [] };

  const rows = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      status: {
        in: [OccurrenceStatus.SCHEDULED, OccurrenceStatus.IN_PROGRESS],
      },
      OR: [
        {
          assigneeKind: ScheduleAssigneeKind.USER,
          assignedPlatformUserId: viewer.id,
        },
        {
          assigneeKind: ScheduleAssigneeKind.ROLE,
          assignedRole: viewer.role as PlatformRole,
        },
      ],
    },
    orderBy: { dueAt: 'asc' },
    take: 200,
    include: {
      schedule: {
        select: {
          title: true,
          reminderOffsetsDays: true,
          auditTemplate: { select: { name: true } },
        },
      },
      jobSite: { select: { name: true } },
    },
  });

  const due: Candidate[] = [];
  const overdue: Candidate[] = [];
  for (const r of rows) {
    const daysUntil = daysBetween(today, r.dueDateLocal);
    const base: Candidate = {
      id: r.id,
      title: r.schedule.title || r.schedule.auditTemplate.name,
      siteName: r.jobSite.name,
      dueDateLocal: r.dueDateLocal,
      timeOfDay: r.timeOfDay,
      daysUntil,
      auditId: r.auditId,
    };
    if (daysUntil < 0) {
      overdue.push(base);
      continue;
    }
    // Only remind inside the schedule's own configured offsets. An empty list
    // means the schedule wants no reminders — respect that rather than inventing
    // a default the manager never asked for.
    const offsets = r.schedule.reminderOffsetsDays;
    if (offsets.length > 0 && daysUntil <= Math.max(...offsets)) {
      due.push(base);
    }
  }
  return { due, overdue };
}

function dueMessage(c: Candidate): string {
  if (c.daysUntil === 0) return `Due today at ${c.timeOfDay}`;
  if (c.daysUntil === 1) return `Due tomorrow at ${c.timeOfDay}`;
  return `Due in ${c.daysUntil} days`;
}

function overdueMessage(c: Candidate): string {
  const n = Math.abs(c.daysUntil);
  return `Overdue since ${formatDateUK(`${c.dueDateLocal}T12:00:00Z`)} — ${n} day${n === 1 ? '' : 's'}`;
}

/**
 * Derived reminder + overdue notifications for the viewer.
 *
 * Registered in the SC-016 aggregator alongside the audit/action/permit/document
 * derivers, so read state, grouping and the bell badge all work unchanged — no
 * separate notification system.
 */
export async function deriveComplianceNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  if (!permits(viewer.role, 'audits', 'view')) return [];

  const [remindersOn, overdueOn] = await Promise.all([
    isNotificationEnabled('compliance_reminders'),
    isNotificationEnabled('compliance_overdue'),
  ]);
  if (!remindersOn && !overdueOn) return [];

  const { due, overdue } = await candidatesFor(viewer, now);
  const out: RawNotification[] = [];
  const today = londonDateStr(now);

  if (overdueOn && overdue.length > 0) {
    out.push(...digestOrRows(overdue, 'COMPLIANCE_OVERDUE', today));
  }
  if (remindersOn && due.length > 0) {
    out.push(...digestOrRows(due, 'COMPLIANCE_DUE', today));
  }
  return out.slice(0, MAX_ROWS);
}

/**
 * Individual rows below the threshold; a single digest row above it. The digest
 * is what stops a daily activity across several sites from burying everything
 * else in the feed.
 */
function digestOrRows(
  items: Candidate[],
  group: 'COMPLIANCE_DUE' | 'COMPLIANCE_OVERDUE',
  today: string,
): RawNotification[] {
  const isOverdue = group === 'COMPLIANCE_OVERDUE';

  if (items.length > DIGEST_THRESHOLD) {
    const sites = new Set(items.map((i) => i.siteName));
    return [
      {
        // Keyed on the day + count so marking it read doesn't permanently
        // silence tomorrow's digest.
        key: `compliance_digest:${group}:${today}:${items.length}`,
        group,
        title: `${items.length} compliance activities ${isOverdue ? 'overdue' : 'due soon'}`,
        message: isOverdue
          ? 'Open the compliance calendar to see what has been missed.'
          : 'Open the compliance calendar to see what is coming up.',
        context: sites.size === 1 ? [...sites][0]! : `${sites.size} sites`,
        meta: items
          .slice(0, 4)
          .map((i) => i.title)
          .join(', ')
          .concat(items.length > 4 ? `, +${items.length - 4} more` : ''),
        href: CALENDAR,
        badgeLabel: isOverdue ? 'Overdue' : 'Due soon',
        badgeClass: isOverdue ? OVERDUE_BADGE : DUE_BADGE,
        chip: `${items.length}`,
        urgency: isOverdue ? -1000 : 0,
      },
    ];
  }

  return items.map((c) => ({
    // One row per OCCURRENCE, never one per reminder offset — otherwise a
    // schedule with offsets [7,3,1] would shout three times about one activity.
    key: `compliance_${isOverdue ? 'overdue' : 'due'}:${c.id}:${c.dueDateLocal}`,
    group,
    title: c.title,
    message: isOverdue ? overdueMessage(c) : dueMessage(c),
    context: c.siteName,
    meta: `Due ${formatDateUK(`${c.dueDateLocal}T12:00:00Z`)} at ${c.timeOfDay}`,
    href: c.auditId ? `/platform/dashboard/audits/${c.auditId}` : CALENDAR,
    badgeLabel: isOverdue ? 'Overdue' : 'Due soon',
    badgeClass: isOverdue ? OVERDUE_BADGE : DUE_BADGE,
    chip: null,
    urgency: c.daysUntil,
  }));
}

export interface EscalationResult {
  escalated: number;
  notified: number;
}

/**
 * Record escalations for occurrences that are overdue beyond their schedule's
 * threshold, and notify.
 *
 * IDEMPOTENT via `escalatedAt`: the update only matches rows where it is still
 * null, so an escalation fires exactly once even though this runs on every
 * calendar read and there is no scheduler yet. The stamp records when the
 * condition was first OBSERVED — the notification always states "overdue since
 * <due date>", so the true elapsed time is never obscured.
 *
 * Notifies BOTH the escalation-role holders and the assignee: being escalated
 * without being told is how people find out in a meeting.
 */
export async function recordEscalations(
  siteIds: string[],
  now: Date = new Date(),
): Promise<EscalationResult> {
  if (siteIds.length === 0) return { escalated: 0, notified: 0 };
  if (!(await isNotificationEnabled('compliance_escalation'))) {
    return { escalated: 0, notified: 0 };
  }

  const today = londonDateStr(now);
  const candidates = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: siteIds },
      status: {
        in: [OccurrenceStatus.SCHEDULED, OccurrenceStatus.IN_PROGRESS],
      },
      escalatedAt: null,
      dueDateLocal: { lt: today },
      schedule: {
        escalateAfterDays: { not: null },
        escalateToRole: { not: null },
      },
    },
    take: 100,
    include: {
      schedule: {
        select: {
          title: true,
          escalateAfterDays: true,
          escalateToRole: true,
          auditTemplate: { select: { name: true } },
        },
      },
      jobSite: { select: { id: true, name: true } },
    },
  });

  let escalated = 0;
  let notified = 0;

  for (const occ of candidates) {
    const threshold = occ.schedule.escalateAfterDays!;
    const daysOverdue = Math.abs(daysBetween(today, occ.dueDateLocal));
    if (daysOverdue < threshold) continue;

    const role = occ.schedule.escalateToRole!;
    // Claim the escalation first. The `escalatedAt: null` filter means only one
    // caller can win, so concurrent calendar reads cannot double-notify.
    const claim = await prisma.complianceOccurrence.updateMany({
      where: { id: occ.id, escalatedAt: null },
      data: { escalatedAt: now, escalatedToRole: role },
    });
    if (claim.count === 0) continue;
    escalated++;

    const holders = await prisma.platformUser.findMany({
      where: {
        status: 'ACTIVE',
        role,
        assignedSites: { some: { id: occ.jobSiteId } },
      },
      select: { id: true },
    });
    const recipientIds = new Set(holders.map((h) => h.id));
    // The assignee too, when they are a platform user.
    if (
      occ.assigneeKind === ScheduleAssigneeKind.USER &&
      occ.assignedPlatformUserId
    ) {
      recipientIds.add(occ.assignedPlatformUserId);
    }
    if (recipientIds.size === 0) continue;

    const title = occ.schedule.title || occ.schedule.auditTemplate.name;
    await prisma.notificationEvent.createMany({
      data: [...recipientIds].map((recipientUserId) => ({
        type: NotificationEventType.COMPLIANCE_ESCALATED,
        recipientUserId,
        title,
        message: `Escalated to ${ROLE_LABELS[role] ?? role} — overdue since ${formatDateUK(`${occ.dueDateLocal}T12:00:00Z`)} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'})`,
        siteName: occ.jobSite.name,
        dueDate: occ.dueAt,
        href: occ.auditId
          ? `/platform/dashboard/audits/${occ.auditId}`
          : CALENDAR,
        actorName: 'SiteComply',
      })),
    });
    notified += recipientIds.size;
  }

  return { escalated, notified };
}
