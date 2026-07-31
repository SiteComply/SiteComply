import type {
  PlatformModule,
  PermissionVerb,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/**
 * SC-022 Phase 1 — contractor access, DATA AND PURE HELPERS ONLY.
 *
 * Client-safe (no Prisma/server imports), mirroring dashboardPanels.ts and
 * siteServiceCatalog.ts, so the configuration UI and the server-side resolver
 * work from ONE definition of what may be narrowed and what the preset means.
 */

/** A per-(user, site, module) override: the verbs the user KEEPS. */
export type PermissionOverride = Partial<
  Record<PlatformModule, PermissionVerb[]>
>;

/** Overrides for one site, keyed by module. */
export type SiteOverrides = Record<string, PermissionOverride>;

/**
 * Modules a Site Manager may narrow.
 *
 * `platformUsers` is excluded because no platform role holds it at all — it is
 * Admin Centre territory, so offering it would imply a capability that does not
 * exist. `dashboard` is excluded because it is the landing page every signed-in
 * user needs; its CONTENT is already gated card by card on the other modules,
 * so hiding the shell itself would strand a user on a redirect loop rather than
 * protect anything.
 */
export const NARROWABLE_MODULES: PlatformModule[] = [
  'sites',
  'checkins',
  'documents',
  'audits',
  'reports',
  'actions',
  'bulletins',
  'permits',
];

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  sites: 'Sites',
  checkins: 'Check-ins',
  documents: 'Documents',
  audits: 'Audits',
  reports: 'Reports',
  actions: 'Actions',
  bulletins: 'Bulletins',
  permits: 'Permits',
  platformUsers: 'Users',
};

/**
 * What each module exposes, phrased for the person deciding whether a
 * contractor should see it. The requirement's "should not see" list is mostly
 * reached through Audits and Reports, so those say so explicitly.
 */
export const MODULE_ACCESS_NOTE: Record<string, string> = {
  sites: 'Site details, address, emergency arrangements and site information.',
  checkins: 'Who has been on site — including other contractors’ personnel.',
  documents: 'Project documents, drawings and RAMS filed against the site.',
  audits:
    'Audit reports, findings and scores. Management information — usually withheld from contractors.',
  reports:
    'Site-wide compliance statistics, KPIs and exports. Management information — usually withheld from contractors.',
  actions: 'Corrective actions, including those assigned to them.',
  bulletins: 'Daily bulletins published to the site.',
  permits: 'Permits to work raised on the site.',
};

/**
 * The seeded "Contractor (standard)" preset.
 *
 * Derived directly from the SC-022 requirement's two lists: contractors keep
 * what they need to do the work (site information, documents/RAMS, their
 * permits, their actions, bulletins) and lose the management information it
 * names — audit reports, site-wide compliance statistics, KPIs, and other
 * contractors' data, which is what the Check-ins register exposes.
 *
 * APPLIED DELIBERATELY, NEVER AUTOMATICALLY. Nothing in this phase reduces an
 * existing user's access on deploy; a Site Manager chooses to apply it, and is
 * shown exactly what changes first.
 *
 * An empty array means the module is hidden entirely on that site.
 */
export const CONTRACTOR_STANDARD_PRESET: PermissionOverride = {
  sites: ['view'],
  checkins: [],
  documents: ['view'],
  audits: [],
  reports: [],
  actions: ['view', 'edit'],
  bulletins: ['view'],
  permits: ['view', 'edit'],
};

export const CONTRACTOR_STANDARD_LABEL = 'Contractor (standard)';

export const CONTRACTOR_STANDARD_DESCRIPTION =
  'Keeps site information, documents, bulletins, and the permits and actions they work on. Removes audit reports, site-wide compliance statistics and other contractors’ check-in records.';

/**
 * Roles the preset is offered for.
 *
 * Advisory only — it is offered as a suggestion, never enforced, and any
 * assigned user can be narrowed by hand. A Director is excluded here and
 * refused in the service: narrowing the only all-sites role is how an
 * organisation locks itself out of its own platform.
 */
export const CONTRACTOR_ROLES: PlatformRoleValue[] = [
  'PRINCIPAL_CONTRACTOR',
  'ENGINEER',
  'CLIENT',
];

/**
 * Intersect a role's baseline verbs with an override — the NARROW-ONLY rule.
 *
 * Pure, and used by BOTH the resolver and the configuration UI so the screen
 * can never show a permission the server would not grant. Anything in the
 * override that the role does not already hold is discarded rather than
 * honoured, so a malformed or stale row can only ever take access away.
 */
export function narrow(
  baseline: PermissionVerb[],
  override: PermissionVerb[] | undefined,
): PermissionVerb[] {
  if (!override) return baseline;
  return baseline.filter((v) => override.includes(v));
}

/** True when an override actually removes something from the baseline. */
export function isNarrowed(
  baseline: PermissionVerb[],
  override: PermissionVerb[] | undefined,
): boolean {
  return narrow(baseline, override).length < baseline.length;
}
