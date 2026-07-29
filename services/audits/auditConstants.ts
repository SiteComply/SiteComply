/**
 * Client-safe Audits module constants (status option list + labels, score
 * bounds). Kept free of any Prisma / server imports so the server service and
 * the client forms share one source of truth. The string values match the
 * Prisma `AuditStatus` enum members exactly.
 */

export type AuditStatusValue =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SIGNED_OFF';

/** Audit statuses in lifecycle order, with human labels. */
export const AUDIT_STATUSES: { value: AuditStatusValue; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'SIGNED_OFF', label: 'Signed off' },
];

const STATUS_LABELS = new Map(AUDIT_STATUSES.map((s) => [s.value, s.label]));

export function auditStatusLabel(value: string): string {
  return STATUS_LABELS.get(value as AuditStatusValue) ?? value;
}

export function isAuditStatus(v: string): v is AuditStatusValue {
  return STATUS_LABELS.has(v as AuditStatusValue);
}

/** Tailwind classes for a status badge, by status. */
export const AUDIT_STATUS_BADGE: Record<AuditStatusValue, string> = {
  DRAFT: 'bg-surface-sunken text-ink-subtle',
  IN_PROGRESS: 'bg-hivis-400/25 text-ink',
  COMPLETED: 'bg-brand-50 text-brand-700',
  SIGNED_OFF: 'bg-safe-50 text-safe-700',
};

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 4000;
export const OBSERVATIONS_MAX = 8000;

/**
 * Roles permitted to permanently DELETE an audit (and its findings). This is a
 * deliberate business rule, not the standard edit permission: Site Manager can
 * create and edit audits (SC-013) but may NOT delete them, while Director — who
 * gained create/edit in the SC-013 follow-up — retains delete for org-wide
 * oversight. So it stays an explicit allow-list rather than a `permits(...)` check.
 */
export const AUDIT_DELETE_ROLES = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'AUDITOR',
  'HS_CONSULTANT',
  'PRINCIPAL_CONTRACTOR',
] as const;

export function canDeleteAudit(role: string): boolean {
  return (AUDIT_DELETE_ROLES as readonly string[]).includes(role);
}
