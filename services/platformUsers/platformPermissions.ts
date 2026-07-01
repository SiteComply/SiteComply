/**
 * Platform RBAC permission matrix — DATA ONLY (foundation for future
 * enforcement). See docs/RBAC.md for the approved design and rationale.
 *
 * IMPORTANT: nothing here is wired up yet. There is NO permission enforcement,
 * menu hiding, role restriction, login restriction or site filtering in the app.
 * These constants and the pure lookup helpers below are the single source of
 * truth that a later stage will consult to enforce access at the API/service
 * layer. Importing this file has no side effects.
 *
 * Kept free of Prisma/server imports (mirrors ./platformUserConstants) so it can
 * be shared by server and client code when enforcement is built.
 */

import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/** Actions a role may perform within a module. */
export type PermissionVerb = 'view' | 'create' | 'edit' | 'export';

/** Functional areas that permissions apply to. */
export type PlatformModule =
  | 'dashboard'
  | 'sites'
  | 'checkins'
  | 'documents'
  | 'audits'
  | 'reports'
  | 'actions'
  | 'platformUsers';

export const PERMISSION_VERBS: PermissionVerb[] = [
  'view',
  'create',
  'edit',
  'export',
];

export const PLATFORM_MODULES: PlatformModule[] = [
  'dashboard',
  'sites',
  'checkins',
  'documents',
  'audits',
  'reports',
  'actions',
  'platformUsers',
];

export interface RolePermissions {
  /**
   * Organisation-wide access: when true the role sees every site and ignores
   * Assigned Sites. Only Director is `true` in v1; every other role is scoped to
   * its `assignedSites`.
   */
  allSites: boolean;
  /** Allowed verbs per module. An empty array means no access to that module. */
  modules: Record<PlatformModule, PermissionVerb[]>;
}

const V: PermissionVerb[] = ['view'];
const VE: PermissionVerb[] = ['view', 'edit'];
const VX: PermissionVerb[] = ['view', 'export'];
const VCE: PermissionVerb[] = ['view', 'create', 'edit'];
const VCX: PermissionVerb[] = ['view', 'create', 'export'];
const VCEX: PermissionVerb[] = ['view', 'create', 'edit', 'export'];
const NONE: PermissionVerb[] = [];

/**
 * The approved permission matrix (docs/RBAC.md §5). Rows are roles, values are
 * the allowed verbs per module. Director is the only organisation-wide role.
 */
export const PLATFORM_PERMISSIONS: Record<PlatformRoleValue, RolePermissions> = {
  DIRECTOR: {
    allSites: true,
    modules: {
      dashboard: V,
      sites: VCEX,
      checkins: VX,
      documents: VCEX,
      audits: VX,
      reports: VCEX,
      actions: VCEX,
      platformUsers: NONE, // Platform Users are Admin-managed only.
    },
  },
  PROJECT_MANAGER: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: VCEX,
      checkins: VX,
      documents: VCEX,
      audits: VCEX,
      reports: VCEX,
      actions: VCEX,
      platformUsers: NONE,
    },
  },
  SITE_MANAGER: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: VE,
      checkins: VX,
      documents: VCEX,
      audits: VX,
      reports: VX,
      actions: VCE,
      platformUsers: NONE,
    },
  },
  CLIENT: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: V,
      checkins: V,
      documents: V,
      audits: V,
      reports: V,
      actions: V, // Read-only: no create/edit/export for Clients in v1.
      platformUsers: NONE,
    },
  },
  AUDITOR: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: V,
      checkins: VX,
      documents: VX,
      audits: VCEX,
      reports: VCX,
      actions: ['view', 'create'],
      platformUsers: NONE,
    },
  },
  ENGINEER: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: V,
      checkins: V, // No export of worker-level/personal data for Engineers.
      documents: VCE,
      audits: V,
      reports: V,
      actions: VCE,
      platformUsers: NONE,
    },
  },
  HS_CONSULTANT: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: VE,
      checkins: VX,
      documents: VCEX,
      audits: VCEX,
      reports: VCX,
      actions: VCE,
      platformUsers: NONE,
    },
  },
  PRINCIPAL_CONTRACTOR: {
    allSites: false,
    modules: {
      dashboard: V,
      sites: VCEX,
      checkins: VX,
      documents: VCEX,
      audits: VCEX,
      reports: VCX,
      actions: VCEX,
      platformUsers: NONE,
    },
  },
};

/**
 * Roles permitted to export datasets/files (check-in records, reports, audits,
 * registers). Clients and Engineers are intentionally excluded so worker-level /
 * personal data cannot be exported by them (docs/RBAC.md §4).
 */
export const EXPORT_CAPABLE_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'SITE_MANAGER',
  'AUDITOR',
  'HS_CONSULTANT',
  'PRINCIPAL_CONTRACTOR',
];

/**
 * Special capabilities that sit outside the view/create/edit/export verbs.
 */

/** Force check-out of a worker (check-in records are otherwise immutable). */
export const CHECKOUT_OVERRIDE_ROLES: PlatformRoleValue[] = [
  'SITE_MANAGER',
  'PROJECT_MANAGER',
  'PRINCIPAL_CONTRACTOR',
];

/** Sign off / approve an audit. */
export const AUDIT_SIGNOFF_ROLES: PlatformRoleValue[] = [
  'AUDITOR',
  'HS_CONSULTANT',
  'PRINCIPAL_CONTRACTOR',
];

// ---------------------------------------------------------------------------
// Pure lookup helpers — inert foundation, NOT called anywhere yet. A future
// enforcement stage will use these; they perform no gating on their own.
// ---------------------------------------------------------------------------

/** Whether `role` may perform `verb` in `module`, per the matrix. */
export function can(
  role: PlatformRoleValue,
  module: PlatformModule,
  verb: PermissionVerb,
): boolean {
  return PLATFORM_PERMISSIONS[role]?.modules[module]?.includes(verb) ?? false;
}

/** Whether `role` has organisation-wide (all-sites) visibility. */
export function roleHasAllSites(role: PlatformRoleValue): boolean {
  return PLATFORM_PERMISSIONS[role]?.allSites ?? false;
}

/** Whether `role` may export datasets/files at all. */
export function canExport(role: PlatformRoleValue): boolean {
  return EXPORT_CAPABLE_ROLES.includes(role);
}
