/**
 * Client-safe Permits (SC-009) constants — status/question option lists, labels,
 * badge classes, field limits and the worker-facing status-timeline definition.
 * No Prisma/server imports, so the server services and client components share
 * one source of truth. String values match the Prisma enums exactly.
 */

export type PermitStatusValue =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'CLOSED';

export const PERMIT_STATUSES: { value: PermitStatusValue; label: string }[] = [
  { value: 'SUBMITTED', label: 'Awaiting approval' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CLOSED', label: 'Closed' },
];

const STATUS_LABELS = new Map(PERMIT_STATUSES.map((s) => [s.value, s.label]));

export function permitStatusLabel(value: string): string {
  return STATUS_LABELS.get(value as PermitStatusValue) ?? value;
}

export function isPermitStatus(v: string): v is PermitStatusValue {
  return STATUS_LABELS.has(v as PermitStatusValue);
}

/** Tailwind badge classes per status (worker + platform share these). */
export const PERMIT_STATUS_BADGE: Record<PermitStatusValue, string> = {
  SUBMITTED: 'bg-hivis-400/25 text-ink',
  UNDER_REVIEW: 'bg-brand-50 text-brand-700',
  APPROVED: 'bg-safe-50 text-safe-700',
  REJECTED: 'bg-danger-50 text-danger-600',
  CANCELLED: 'bg-surface-sunken text-ink-subtle',
  EXPIRED: 'bg-surface-sunken text-ink-subtle',
  CLOSED: 'bg-surface-sunken text-ink-subtle',
};

/** Tone for the worker detail banner + panel-card, by status. */
export type PermitTone = 'brand' | 'safe' | 'hivis' | 'danger' | 'muted';
export const PERMIT_STATUS_TONE: Record<PermitStatusValue, PermitTone> = {
  SUBMITTED: 'hivis',
  UNDER_REVIEW: 'brand',
  APPROVED: 'safe',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
  CLOSED: 'muted',
};

/** Statuses that count as an "active" permit (worker dashboard + list). */
export const ACTIVE_PERMIT_STATUSES: PermitStatusValue[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
];

/** Statuses awaiting a manager decision (drives the manager notification). */
export const PENDING_PERMIT_STATUSES: PermitStatusValue[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
];

/** Whether a worker may cancel a permit in this status. */
export function canWorkerCancel(status: string): boolean {
  return (
    status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'APPROVED'
  );
}

/**
 * The three-stage progress shown on the worker's status timeline. Each real
 * status maps to a stage so the timeline reads Submitted → Under review →
 * Decision, matching the REV-1 design.
 */
export const PERMIT_TIMELINE_STAGES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'review', label: 'Under review' },
  { key: 'decision', label: 'Decision' },
] as const;

// ── Question types (mirror Prisma PermitQuestionType) ────────────────────────

export type PermitQuestionTypeValue =
  | 'ACKNOWLEDGEMENT'
  | 'YES_NO'
  | 'TEXT'
  | 'DATE';

// ── Field limits ─────────────────────────────────────────────────────────────

export const WORK_ACTIVITY_MAX = 300;
export const WORK_LOCATION_MAX = 200;
export const ANSWER_TEXT_MAX = 500;
export const REJECTION_REASON_MAX = 500;
export const PERMIT_NOTE_MAX = 500;
