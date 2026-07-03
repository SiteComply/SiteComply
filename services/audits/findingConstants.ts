/**
 * Client-safe audit-finding constants (category / severity / status option lists
 * + labels + badge styles). Kept free of any Prisma / server imports so the
 * server service and the client forms share one source of truth. String values
 * match the Prisma `FindingCategory` / `FindingSeverity` / `FindingStatus` enums.
 */

export type FindingCategoryValue =
  | 'SAFETY'
  | 'ENVIRONMENTAL'
  | 'QUALITY'
  | 'DOCUMENTATION'
  | 'OTHER';

export type FindingSeverityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type FindingStatusValue = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export const FINDING_CATEGORIES: {
  value: FindingCategoryValue;
  label: string;
}[] = [
  { value: 'SAFETY', label: 'Health & Safety' },
  { value: 'ENVIRONMENTAL', label: 'Environmental' },
  { value: 'QUALITY', label: 'Quality' },
  { value: 'DOCUMENTATION', label: 'Documentation' },
  { value: 'OTHER', label: 'Other' },
];

export const FINDING_SEVERITIES: {
  value: FindingSeverityValue;
  label: string;
}[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export const FINDING_STATUSES: { value: FindingStatusValue; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'CLOSED', label: 'Closed' },
];

const CAT = new Map(FINDING_CATEGORIES.map((c) => [c.value, c.label]));
const SEV = new Map(FINDING_SEVERITIES.map((s) => [s.value, s.label]));
const STA = new Map(FINDING_STATUSES.map((s) => [s.value, s.label]));

export const findingCategoryLabel = (v: string) =>
  CAT.get(v as FindingCategoryValue) ?? v;
export const findingSeverityLabel = (v: string) =>
  SEV.get(v as FindingSeverityValue) ?? v;
export const findingStatusLabel = (v: string) =>
  STA.get(v as FindingStatusValue) ?? v;

export const isFindingCategory = (v: string): v is FindingCategoryValue =>
  CAT.has(v as FindingCategoryValue);
export const isFindingSeverity = (v: string): v is FindingSeverityValue =>
  SEV.has(v as FindingSeverityValue);
export const isFindingStatus = (v: string): v is FindingStatusValue =>
  STA.has(v as FindingStatusValue);

/** Tailwind badge classes. */
export const FINDING_SEVERITY_BADGE: Record<FindingSeverityValue, string> = {
  LOW: 'bg-surface-sunken text-ink-subtle',
  MEDIUM: 'bg-hivis-400/25 text-ink',
  HIGH: 'bg-danger-50 text-danger-700',
  CRITICAL: 'bg-danger-600 text-white',
};

export const FINDING_STATUS_BADGE: Record<FindingStatusValue, string> = {
  OPEN: 'bg-danger-50 text-danger-700',
  IN_PROGRESS: 'bg-hivis-400/25 text-ink',
  CLOSED: 'bg-safe-50 text-safe-700',
};

export const FINDING_TITLE_MAX = 200;
export const FINDING_DESCRIPTION_MAX = 4000;
export const FINDING_ACTION_MAX = 4000;
