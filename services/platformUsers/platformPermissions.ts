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
  | 'bulletins'
  | 'permits'
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
  'bulletins',
  'permits',
  'platformUsers',
];

/**
 * SC-022 — runtime guard for a module name read back from storage.
 *
 * Override rows store the module as a string so adding a module stays a code
 * change; an unrecognised value is DISCARDED rather than trusted, so a stale
 * row can never resolve to a permission decision.
 */
export function isPlatformModule(v: unknown): v is PlatformModule {
  return typeof v === 'string' && (PLATFORM_MODULES as string[]).includes(v);
}

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
export const PLATFORM_PERMISSIONS: Record<PlatformRoleValue, RolePermissions> =
  {
    DIRECTOR: {
      allSites: true,
      modules: {
        dashboard: V,
        sites: VCEX,
        checkins: VX,
        documents: VCEX,
        // SC-013 follow-up: Directors may now create + edit audits and create
        // templates (template create is gated on this `create` verb). Sign-off
        // stays restricted to AUDIT_SIGNOFF_ROLES — Director is deliberately
        // excluded, and reopening a signed-off audit remains a sign-off-only act.
        audits: VCEX,
        reports: VCEX,
        actions: VCEX,
        bulletins: VCEX,
        permits: VE,
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
        bulletins: VCEX,
        permits: VE,
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
        // SC-013: Site Managers can now create + edit audits on site (sign-off and
        // delete remain restricted to their existing allow-lists).
        audits: VCEX,
        reports: VX,
        actions: VCE,
        bulletins: VCE, // Site managers publish Daily Bulletins for their site.
        permits: VE,
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
        bulletins: V,
        permits: V,
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
        bulletins: V,
        permits: V,
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
        bulletins: V,
        permits: V,
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
        bulletins: VCE,
        permits: VE,
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
        bulletins: VCEX,
        permits: VE,
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

/**
 * Whether `role` may sign off an audit (move it to SIGNED_OFF). This is a
 * deliberate business rule separate from the audits "edit" permission: several
 * edit-capable roles (e.g. Project Manager) can progress an audit through its
 * lifecycle but must NOT be the ones to formally sign it off.
 */
export function canSignOffAudit(role: PlatformRoleValue): boolean {
  return AUDIT_SIGNOFF_ROLES.includes(role);
}

/**
 * Manage the SHARED, organisation-level audit template library (SC-013): edit an
 * existing template or delete one. Any audit-creating role may save a NEW template
 * and use templates, but editing/deleting a shared template — which affects every
 * site — is restricted so a single Site Manager can't break an org-wide format.
 */
export const AUDIT_TEMPLATE_MANAGE_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'AUDITOR',
  'HS_CONSULTANT',
];

export function canManageAuditTemplates(role: PlatformRoleValue): boolean {
  return AUDIT_TEMPLATE_MANAGE_ROLES.includes(role);
}

/**
 * Approve or reject a Permit to Work (SC-009). A deliberate business rule
 * separate from the `permits` "edit" verb: an edit-capable role (e.g. H&S
 * Consultant) may review, comment and close permits, but only these roles may
 * formally approve/reject one — mirroring the audit sign-off allow-list.
 */
export const PERMIT_APPROVAL_ROLES: PlatformRoleValue[] = [
  'SITE_MANAGER',
  'PROJECT_MANAGER',
  'DIRECTOR',
  'PRINCIPAL_CONTRACTOR',
];

export function canApprovePermit(role: PlatformRoleValue): boolean {
  return PERMIT_APPROVAL_ROLES.includes(role);
}

/**
 * Manage the SHARED, organisation-level site configuration template library
 * (SC-021 Phase 2): edit or delete an existing template.
 *
 * NARROWER than the audit template library on purpose. An audit template shapes
 * one audit; a configuration template decides which permits and inspections a
 * whole project may use, so reshaping a shared one is a management decision
 * rather than a safety-professional one. Anyone with `sites:edit` may still SAVE
 * a new template from a site they configure, and apply templates — mirroring
 * SC-013, where any audit-creating role can save a template but not edit a
 * shared one.
 */
export const SITE_CONFIG_TEMPLATE_MANAGE_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
];

export function canManageSiteConfigTemplates(role: PlatformRoleValue): boolean {
  return SITE_CONFIG_TEMPLATE_MANAGE_ROLES.includes(role);
}

/**
 * Create a brand-new job site from the Platform portal. This is deliberately
 * NARROWER than the `sites` "create" verb in the matrix (which several
 * management roles hold for future within-site management affordances):
 * spinning up a new site organisation-wide is a Director-only capability.
 * Every other role keeps its existing view/manage permissions and never sees
 * the create affordance.
 */
export const SITE_CREATE_ROLES: PlatformRoleValue[] = ['DIRECTOR'];

export function canCreateSite(role: PlatformRoleValue): boolean {
  return SITE_CREATE_ROLES.includes(role);
}

/**
 * Edit an existing job site (details, address, and archive/reactivate via its
 * status) from the Platform portal. Like creation, this is a Director-only
 * capability — other roles keep their existing view/manage permissions and never
 * see the edit affordance. Archiving and reactivating a site are status edits, so
 * they are governed by this same capability.
 */
export const SITE_EDIT_ROLES: PlatformRoleValue[] = ['DIRECTOR'];

export function canEditSite(role: PlatformRoleValue): boolean {
  return SITE_EDIT_ROLES.includes(role);
}

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

// ---------------------------------------------------------------------------
// Phased rollout of enforcement.
// ---------------------------------------------------------------------------

/**
 * Roles whose permissions are ENFORCED. All eight roles are now enforced by the
 * approved matrix (Phase 2 complete). The list is retained so a role could be
 * temporarily excluded from enforcement if ever needed.
 */
export const RBAC_ENFORCED_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'CLIENT',
  'SITE_MANAGER',
  'AUDITOR',
  'ENGINEER',
  'HS_CONSULTANT',
  'PRINCIPAL_CONTRACTOR',
];

export function isRbacEnforced(role: PlatformRoleValue): boolean {
  return RBAC_ENFORCED_ROLES.includes(role);
}

/**
 * Effective permission check for the current rollout: enforced roles are gated
 * by the matrix; any other role is unchanged (allowed) for now. Use this
 * everywhere (nav, pages, buttons, API) so partial rollout is consistent.
 */
export function permits(
  role: PlatformRoleValue,
  module: PlatformModule,
  verb: PermissionVerb,
): boolean {
  if (!isRbacEnforced(role)) return true;
  return can(role, module, verb);
}

/**
 * True when an enforced role can only view — no create/edit/export in any
 * module (Client in v1). Used to surface a "Read-only" indicator.
 */
export function isReadOnlyRole(role: PlatformRoleValue): boolean {
  if (!isRbacEnforced(role)) return false;
  return PLATFORM_MODULES.every((m) => {
    const verbs = PLATFORM_PERMISSIONS[role].modules[m];
    return (
      !verbs.includes('create') &&
      !verbs.includes('edit') &&
      !verbs.includes('export')
    );
  });
}
