/**
 * Client-safe Platform User constants (role & status option lists and labels).
 *
 * Kept free of any Prisma / server imports so both the server service and the
 * client add/edit form can share one source of truth. The string values match
 * the Prisma `PlatformRole` / `PlatformUserStatus` enum members exactly.
 */

export type PlatformRoleValue =
  | 'DIRECTOR'
  | 'PROJECT_MANAGER'
  | 'CLIENT'
  | 'AUDITOR'
  | 'ENGINEER'
  | 'HS_CONSULTANT'
  | 'PRINCIPAL_CONTRACTOR';

export type PlatformStatusValue = 'PENDING' | 'ACTIVE' | 'DISABLED';

/** Selectable platform roles, in display order, with human labels. */
export const PLATFORM_ROLES: { value: PlatformRoleValue; label: string }[] = [
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'CLIENT', label: 'Client' },
  { value: 'AUDITOR', label: 'Auditor' },
  { value: 'ENGINEER', label: 'Engineer' },
  { value: 'HS_CONSULTANT', label: 'H&S Consultant' },
  { value: 'PRINCIPAL_CONTRACTOR', label: 'Principal Contractor' },
];

/** Selectable statuses, in lifecycle order, with human labels. */
export const PLATFORM_STATUSES: {
  value: PlatformStatusValue;
  label: string;
}[] = [
  { value: 'PENDING', label: 'Pending approval' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DISABLED', label: 'Disabled' },
];

export const ROLE_LABELS = Object.fromEntries(
  PLATFORM_ROLES.map((r) => [r.value, r.label]),
) as Record<PlatformRoleValue, string>;

export const STATUS_LABELS = Object.fromEntries(
  PLATFORM_STATUSES.map((s) => [s.value, s.label]),
) as Record<PlatformStatusValue, string>;
