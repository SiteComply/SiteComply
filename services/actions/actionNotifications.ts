import { ActionStatus, ActionActivityType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  isNotificationEnabled,
  getNotificationThresholds,
  reminderOffsets,
} from '@/services/notifications/notificationConfigService';
import { actionPriorityLabel, ACTION_OVERDUE_BADGE } from '@/services/actions/actionConstants';
import { formatDateUK } from '@/lib/datetime';
import type { RawNotification } from '@/services/notifications/notificationTypes';

/**
 * Action notifications — DERIVED on read from corrective actions, mapped into the
 * unified RawNotification shape. Four triggers, each gated by its own notification
 * type in Admin → Settings → Notifications:
 *   - overdue_actions        → OPEN/IN_PROGRESS actions past their due date
 *   - action_due_reminders   → due within 7 / 3 days
 *   - action_assigned        → assigned or reassigned within the last 7 days
 * All are gated by the actions "view" permission and scoped to the viewer's
 * Assigned Sites, so only users with access to an action ever see its notifications.
 */

/**
 * FALLBACK ONLY. The lead time is organisation-configurable (Settings ->
 * Notifications); these are what applies before anyone has set one, and they
 * are the values this file used when they were hard-coded. The second offset
 * is kept as a step so a reminder still repeats closer to the date.
 */
export const ACTION_DUE_THRESHOLDS = [7, 3] as const;
const DUE_STEPS = [3];
const ASSIGNED_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const ACTIVE = [ActionStatus.OPEN, ActionStatus.IN_PROGRESS];

const DUE_BADGE = 'bg-hivis-400/25 text-ink';
const ASSIGNED_BADGE = 'bg-brand-50 text-brand-700';

function overdueMessage(days: number): string {
  const over = Math.abs(days);
  return over === 1 ? 'Overdue by 1 day' : `Overdue by ${over} days`;
}
function dueMessage(days: number): string {
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export async function deriveActionNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  if (viewer.siteIds.length === 0) return [];
  if (!permits(viewer.role, 'actions', 'view')) return [];

  const [overdueEnabled, dueEnabled, assignedEnabled] = await Promise.all([
    isNotificationEnabled('overdue_actions'),
    isNotificationEnabled('action_due_reminders'),
    isNotificationEnabled('action_assigned'),
  ]);
  if (!overdueEnabled && !dueEnabled && !assignedEnabled) return [];

  // Organisation-configurable lead time, widest first. Read here rather than at
  // module load so a change applies to the next request, not the next restart.
  const { actionDueDays } = await getNotificationThresholds();
  const dueThresholds = reminderOffsets(actionDueDays, DUE_STEPS);

  const todayMs = utcDay(now);
  const out: RawNotification[] = [];

  // --- Overdue + due-soon (share one query on the due window) ---
  if (overdueEnabled || dueEnabled) {
    const cutoff = new Date(todayMs + dueThresholds[0]! * DAY_MS);
    const actions = await prisma.action.findMany({
      where: {
        jobSiteId: { in: viewer.siteIds },
        status: { in: ACTIVE },
        dueDate: { not: null, lte: cutoff },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        title: true,
        priority: true,
        dueDate: true,
        jobSite: { select: { name: true } },
      },
    });

    for (const a of actions) {
      if (!a.dueDate) continue;
      const daysUntilDue = Math.round((utcDay(a.dueDate) - todayMs) / DAY_MS);
      const context = `${actionPriorityLabel(a.priority)} priority · ${a.jobSite.name}`;
      const meta = `Due ${formatDateUK(a.dueDate)}`;
      const href = `/platform/dashboard/actions/${a.id}`;

      if (daysUntilDue < 0) {
        if (!overdueEnabled) continue;
        out.push({
          key: `overdue_actions:${a.id}:overdue`,
          group: 'ACTION_OVERDUE',
          title: a.title,
          message: overdueMessage(daysUntilDue),
          context,
          meta,
          href,
          badgeLabel: 'Overdue',
          badgeClass: ACTION_OVERDUE_BADGE,
          chip: null,
          urgency: daysUntilDue,
        });
        continue;
      }
      if (!dueEnabled) continue;
      const crossed = dueThresholds.filter((t) => daysUntilDue <= t);
      if (crossed.length === 0) continue;
      const threshold = Math.min(...crossed);
      out.push({
        key: `action_due_reminders:${a.id}:t${threshold}`,
        group: 'ACTION_DUE',
        title: a.title,
        message: dueMessage(daysUntilDue),
        context,
        meta,
        href,
        badgeLabel: 'Due soon',
        badgeClass: DUE_BADGE,
        chip: `${threshold}-day reminder`,
        urgency: daysUntilDue,
      });
    }
  }

  // --- Newly assigned (from ASSIGNMENT activity in the last 7 days) ---
  if (assignedEnabled) {
    const since = new Date(now.getTime() - ASSIGNED_WINDOW_DAYS * DAY_MS);
    const events = await prisma.actionActivity.findMany({
      where: {
        type: ActionActivityType.ASSIGNMENT,
        toValue: { not: null },
        createdAt: { gte: since },
        action: { jobSiteId: { in: viewer.siteIds }, status: { in: ACTIVE } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        actionId: true,
        toValue: true,
        createdAt: true,
        action: {
          select: {
            title: true,
            priority: true,
            dueDate: true,
            jobSite: { select: { name: true } },
          },
        },
      },
    });

    const seen = new Set<string>();
    for (const e of events) {
      if (seen.has(e.actionId)) continue; // latest assignment per action only
      seen.add(e.actionId);
      const daysSince = Math.round((todayMs - utcDay(e.createdAt)) / DAY_MS);
      out.push({
        key: `action_assigned:${e.actionId}:${e.id}`,
        group: 'ACTION_ASSIGNED',
        title: e.action.title,
        message: `Assigned to ${e.toValue}`,
        context: `${actionPriorityLabel(e.action.priority)} priority · ${e.action.jobSite.name}`,
        meta: e.action.dueDate ? `Due ${formatDateUK(e.action.dueDate)}` : 'No due date',
        href: `/platform/dashboard/actions/${e.actionId}`,
        badgeLabel: 'Assigned',
        badgeClass: ASSIGNED_BADGE,
        chip: null,
        urgency: daysSince,
      });
    }
  }

  return out;
}
