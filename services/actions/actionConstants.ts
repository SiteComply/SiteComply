/**
 * Client-safe Actions module constants (priority / status option lists, labels,
 * badge styles). No Prisma / server imports so the server service and client
 * forms share one source of truth. Values match the Prisma `ActionPriority` /
 * `ActionStatus` enums.
 */

export type ActionPriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActionStatusValue = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';

/** A register bucket — includes the derived "overdue" view. */
export type ActionBucket = 'OPEN' | 'IN_PROGRESS' | 'OVERDUE' | 'COMPLETED';

export const ACTION_PRIORITIES: {
  value: ActionPriorityValue;
  label: string;
}[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export const ACTION_STATUSES: { value: ActionStatusValue; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
];

/** Register filter buckets, in display order. */
export const ACTION_BUCKETS: { value: ActionBucket; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'COMPLETED', label: 'Completed' },
];

const PRI = new Map(ACTION_PRIORITIES.map((p) => [p.value, p.label]));
const STA = new Map(ACTION_STATUSES.map((s) => [s.value, s.label]));

export const actionPriorityLabel = (v: string) =>
  PRI.get(v as ActionPriorityValue) ?? v;
export const actionStatusLabel = (v: string) =>
  STA.get(v as ActionStatusValue) ?? v;

export const isActionPriority = (v: string): v is ActionPriorityValue =>
  PRI.has(v as ActionPriorityValue);
export const isActionStatus = (v: string): v is ActionStatusValue =>
  STA.has(v as ActionStatusValue);
export const isActionBucket = (v: string): v is ActionBucket =>
  v === 'OPEN' || v === 'IN_PROGRESS' || v === 'OVERDUE' || v === 'COMPLETED';

export const ACTION_PRIORITY_BADGE: Record<ActionPriorityValue, string> = {
  LOW: 'bg-surface-sunken text-ink-subtle',
  MEDIUM: 'bg-hivis-400/25 text-ink',
  HIGH: 'bg-danger-50 text-danger-700',
  CRITICAL: 'bg-danger-600 text-white',
};

export const ACTION_STATUS_BADGE: Record<ActionStatusValue, string> = {
  OPEN: 'bg-brand-50 text-brand-700',
  IN_PROGRESS: 'bg-hivis-400/25 text-ink',
  COMPLETED: 'bg-safe-50 text-safe-700',
};

/** Badge for the derived "overdue" flag. */
export const ACTION_OVERDUE_BADGE = 'bg-danger-600 text-white';

export const ACTION_TITLE_MAX = 200;
export const ACTION_DESCRIPTION_MAX = 4000;
export const ACTION_ASSIGNEE_MAX = 160;
export const ACTION_NOTE_MAX = 4000;

export type ActionActivityTypeValue =
  | 'CREATED'
  | 'COMMENT'
  | 'STATUS_CHANGE'
  | 'ASSIGNMENT';
