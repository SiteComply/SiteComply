import { NotificationEventType, type Action } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { RawNotification } from '@/services/notifications/notificationTypes';
import { formatDateUK } from '@/lib/datetime';
import {
  actionPriorityLabel,
  actionStatusLabel,
} from '@/services/actions/actionConstants';

/**
 * SC-016 — assignee-addressed notification events.
 *
 * The rest of the framework DERIVES notifications from current state on each
 * read, which suits "this is overdue" but cannot record that a specific person
 * was told something at a specific moment. Assignment and meaningful changes are
 * discrete occurrences, so they are STORED: auditable, unaffected by later edits
 * to the action, and available to future reporting.
 *
 * These sit ALONGSIDE the existing site-scoped manager notifications rather than
 * replacing them — a manager still sees activity on their sites; the assignee now
 * additionally gets told directly.
 *
 * V1 recipients are PLATFORM USERS only. A worker assignee is deliberately not
 * notified until worker-side action visibility exists (deferred from SC-015).
 */

const ASSIGNED_BADGE = 'bg-brand-50 text-brand-700';
const UPDATED_BADGE = 'bg-surface-sunken text-ink-muted';

/** Window of stored events surfaced in the feed. */
const EVENT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActionSnapshot {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: Date | null;
  siteName: string;
  assignedPlatformUserId: string | null;
}

/** Everything the requirement asks a notification to carry. */
function payload(action: ActionSnapshot) {
  return {
    actionId: action.id,
    title: action.title,
    siteName: action.siteName,
    priority: action.priority,
    dueDate: action.dueDate,
    description: action.description,
    href: `/platform/dashboard/actions/${action.id}`,
  };
}

async function record(
  type: NotificationEventType,
  recipientUserId: string,
  action: ActionSnapshot,
  message: string,
  actorName: string | null,
): Promise<void> {
  const p = payload(action);
  await prisma.notificationEvent.create({
    data: {
      type,
      recipientUserId,
      actionId: p.actionId,
      title: p.title,
      message,
      siteName: p.siteName,
      priority: p.priority,
      dueDate: p.dueDate,
      description: p.description,
      href: p.href,
      actorName,
    },
  });
}

/**
 * Raise the "you have been assigned this action" event. No-op when the assignee
 * is a worker (not yet notifiable) or when someone assigns an action to
 * themselves — being told what you just did is noise.
 */
export async function notifyAssigned(
  action: ActionSnapshot,
  actor: PlatformViewer,
  reassigned = false,
): Promise<void> {
  const recipient = action.assignedPlatformUserId;
  if (!recipient) return;
  if (recipient === actor.id) return;

  await record(
    reassigned
      ? NotificationEventType.ACTION_REASSIGNED
      : NotificationEventType.ACTION_ASSIGNED,
    recipient,
    action,
    reassigned
      ? `Reassigned to you by ${actor.name}`
      : `Assigned to you by ${actor.name}`,
    actor.name,
  );
}

/**
 * Raise events for MEANINGFUL changes only — status, priority and due date.
 * Deliberately not every edit: notifying on a description typo would train people
 * to ignore the bell.
 */
export async function notifyMeaningfulChange(
  before: Pick<Action, 'status' | 'priority' | 'dueDate'>,
  after: ActionSnapshot,
  actor: PlatformViewer,
): Promise<void> {
  const recipient = after.assignedPlatformUserId;
  if (!recipient || recipient === actor.id) return;

  if (before.status !== after.status) {
    await record(
      NotificationEventType.ACTION_STATUS_CHANGED,
      recipient,
      after,
      `Status changed to ${actionStatusLabel(after.status)} by ${actor.name}`,
      actor.name,
    );
  }
  if (before.priority !== after.priority) {
    await record(
      NotificationEventType.ACTION_PRIORITY_CHANGED,
      recipient,
      after,
      `Priority changed to ${actionPriorityLabel(after.priority)} by ${actor.name}`,
      actor.name,
    );
  }
  const beforeDue = before.dueDate ? before.dueDate.getTime() : null;
  const afterDue = after.dueDate ? after.dueDate.getTime() : null;
  if (beforeDue !== afterDue) {
    await record(
      NotificationEventType.ACTION_DUE_DATE_CHANGED,
      recipient,
      after,
      after.dueDate
        ? `Due date changed to ${formatDateUK(after.dueDate)} by ${actor.name}`
        : `Due date removed by ${actor.name}`,
      actor.name,
    );
  }
}

const GROUP_FOR: Record<
  NotificationEventType,
  'ACTION_ASSIGNED_TO_ME' | 'ACTION_UPDATED'
> = {
  ACTION_ASSIGNED: 'ACTION_ASSIGNED_TO_ME',
  ACTION_REASSIGNED: 'ACTION_ASSIGNED_TO_ME',
  ACTION_STATUS_CHANGED: 'ACTION_UPDATED',
  ACTION_PRIORITY_CHANGED: 'ACTION_UPDATED',
  ACTION_DUE_DATE_CHANGED: 'ACTION_UPDATED',
};

/**
 * Stored events addressed to this viewer, as feed notifications.
 *
 * Note there is NO site-scope filter here, by design: these are addressed to the
 * person, and being assigned something is itself grounds to be told about it. The
 * event is only ever created for the assignee, so this cannot leak another site's
 * data — the recipient id IS the authorisation.
 */
export async function deriveAssigneeNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  const since = new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY_MS);
  const events = await prisma.notificationEvent.findMany({
    where: { recipientUserId: viewer.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return events.map((e) => {
    const group = GROUP_FOR[e.type];
    const bits = [e.siteName];
    if (e.priority) bits.push(`${actionPriorityLabel(e.priority)} priority`);
    if (e.dueDate) bits.push(`Due ${formatDateUK(e.dueDate)}`);
    return {
      key: `notification_event:${e.id}`,
      group,
      title: e.title,
      message: e.message,
      context: bits.join(' · '),
      // The requirement asks the notification to carry the description; it is
      // trimmed here so a long action body can't dominate the feed.
      meta: e.description
        ? truncate(e.description, 140)
        : formatDateUK(e.createdAt),
      href: e.href,
      badgeLabel:
        group === 'ACTION_ASSIGNED_TO_ME' ? 'Assigned to you' : 'Updated',
      badgeClass:
        group === 'ACTION_ASSIGNED_TO_ME' ? ASSIGNED_BADGE : UPDATED_BADGE,
      chip: e.priority ? actionPriorityLabel(e.priority) : null,
      urgency: -e.createdAt.getTime(), // newest first within the group
    };
  });
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * SC-016 — "approaching its due date", addressed to the assignee personally.
 *
 * DERIVED rather than stored: unlike assignment or a status change, this is a
 * state ("due in 3 days"), not an occurrence — storing it would need a scheduler
 * to fire daily, and would go stale the moment the due date moved. The existing
 * site-scoped `action_due_reminders` still covers managers; this is the personal
 * one.
 */
export async function deriveAssigneeDueSoon(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  const horizon = new Date(now.getTime() + 7 * DAY_MS);
  const actions = await prisma.action.findMany({
    where: {
      assignedPlatformUserId: viewer.id,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      dueDate: { not: null, lte: horizon },
    },
    orderBy: { dueDate: 'asc' },
    take: 25,
    select: {
      id: true,
      title: true,
      priority: true,
      dueDate: true,
      jobSite: { select: { name: true } },
    },
  });

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return actions.map((a) => {
    const due = a.dueDate!;
    const dueDay = Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth(),
      due.getUTCDate(),
    );
    const days = Math.round((dueDay - today) / DAY_MS);
    const overdue = days < 0;
    return {
      key: `assignee_due:${a.id}:${dueDay}`,
      group: 'ACTION_UPDATED' as const,
      title: a.title,
      message: overdue
        ? `Assigned to you · overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
        : days === 0
          ? 'Assigned to you · due today'
          : `Assigned to you · due in ${days} day${days === 1 ? '' : 's'}`,
      context: `${a.jobSite.name} · ${actionPriorityLabel(a.priority)} priority`,
      meta: `Due ${formatDateUK(due)}`,
      href: `/platform/dashboard/actions/${a.id}`,
      badgeLabel: overdue ? 'Overdue' : 'Due soon',
      badgeClass: overdue
        ? 'bg-danger-50 text-danger-700'
        : 'bg-hivis-400/25 text-ink',
      chip: actionPriorityLabel(a.priority),
      urgency: days,
    };
  });
}
