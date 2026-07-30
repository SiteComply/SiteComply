/**
 * Client-safe notification shapes + display metadata. Kept free of any server
 * imports (no prisma) so both the server aggregator and the client list can use
 * them. Adding a new group/source touches only this file + the deriver.
 */

export type NotificationGroup =
  | 'PERMIT_AWAITING'
  | 'ACTION_OVERDUE'
  | 'DOC_EXPIRED'
  | 'ACTION_DUE'
  | 'DOC_EXPIRING'
  | 'ACTION_ASSIGNED'
  // SC-016: addressed to the assignee personally, distinct from the site-scoped
  // manager types above.
  | 'ACTION_ASSIGNED_TO_ME'
  | 'ACTION_UPDATED'
  // SC-020 Phase 2 — scheduled compliance activities.
  | 'COMPLIANCE_ESCALATED'
  | 'COMPLIANCE_OVERDUE'
  | 'COMPLIANCE_DUE'
  | 'AUDIT_CREATED'
  | 'AUDIT_SIGNED_OFF';

/** A derived notification before per-user read state is applied. */
export interface RawNotification {
  key: string;
  group: NotificationGroup;
  title: string;
  message: string;
  context: string;
  meta: string;
  href: string;
  badgeLabel: string;
  badgeClass: string;
  chip: string | null;
  /** Sort within a group; lower = more urgent. */
  urgency: number;
}

export interface PlatformNotification extends RawNotification {
  read: boolean;
}

/** Display metadata per group: heading, accent colour and display order. */
export const NOTIFICATION_GROUP_META: Record<
  NotificationGroup,
  { title: string; accent: string; order: number }
> = {
  PERMIT_AWAITING: {
    title: 'Permits awaiting approval',
    accent: 'text-hivis-600',
    order: 0,
  },
  ACTION_OVERDUE: {
    title: 'Overdue actions',
    accent: 'text-danger-700',
    order: 1,
  },
  DOC_EXPIRED: { title: 'Expired', accent: 'text-danger-700', order: 2 },
  ACTION_DUE: { title: 'Actions due soon', accent: 'text-hivis-600', order: 3 },
  DOC_EXPIRING: { title: 'Expiring soon', accent: 'text-hivis-600', order: 4 },
  // SC-016 — your own items come FIRST: being personally responsible outranks
  // site-wide awareness.
  // SC-020 Phase 2 — an escalation outranks everything: it means something has
  // already been missed and management has been told.
  COMPLIANCE_ESCALATED: {
    title: 'Escalated compliance activities',
    accent: 'text-danger-700',
    order: -4,
  },
  COMPLIANCE_OVERDUE: {
    title: 'Overdue compliance activities',
    accent: 'text-danger-700',
    order: -3,
  },
  COMPLIANCE_DUE: {
    title: 'Compliance activities due soon',
    accent: 'text-hivis-600',
    order: 0,
  },
  ACTION_ASSIGNED_TO_ME: {
    title: 'Assigned to you',
    accent: 'text-brand-700',
    order: -2,
  },
  ACTION_UPDATED: {
    title: 'Your actions were updated',
    accent: 'text-ink-muted',
    order: -1,
  },
  ACTION_ASSIGNED: {
    title: 'Newly assigned actions',
    accent: 'text-brand-700',
    order: 5,
  },
  AUDIT_CREATED: { title: 'New audits', accent: 'text-brand-700', order: 6 },
  AUDIT_SIGNED_OFF: {
    title: 'Audits signed off',
    accent: 'text-safe-700',
    order: 7,
  },
};
