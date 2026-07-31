import {
  PERMISSION_VERBS,
  permits,
  type PlatformModule,
  type PermissionVerb,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import {
  narrow,
  type SiteOverrides,
} from '@/services/platformUsers/contractorAccessConstants';

/**
 * SC-022 — effective permission resolution. PURE.
 *
 * Deliberately separate from platformAccess, which wraps the viewer loader in
 * React's request `cache()` and therefore only runs inside a request. The rules
 * that decide what someone may see are the most safety-critical code in the
 * platform and must be testable on their own, without a server context.
 *
 * Takes the minimal shape rather than the full PlatformViewer, so there is no
 * circular import and any caller can be checked structurally.
 */
export interface ViewerPermissionContext {
  role: PlatformRoleValue;
  siteIds: string[];
  overrides: SiteOverrides;
}

/**
 * The viewer's effective verbs for a module on ONE site: the role baseline
 * INTERSECTED with any override.
 *
 * `narrow` discards anything the role does not already hold, so this can only
 * ever return a subset of the baseline — an override is structurally incapable
 * of granting access, whatever is stored.
 */
export function effectiveVerbs(
  viewer: ViewerPermissionContext,
  module: PlatformModule,
  siteId: string,
): PermissionVerb[] {
  const baseline = PERMISSION_VERBS.filter((v) =>
    permits(viewer.role, module, v),
  );
  // A DIRECTOR is never narrowed — the only all-sites role, and an organisation
  // that can lock its own Directors out has no way back in.
  if (viewer.role === 'DIRECTOR') return baseline;
  return narrow(baseline, viewer.overrides[siteId]?.[module]);
}

/**
 * Whether the viewer may perform `verb` on `module`.
 *
 * With a `siteId`, answers for that site. WITHOUT one, answers "on ANY site they
 * can see" — the right question for global surfaces like the navigation, where
 * one answer must cover several sites. Per-site truth is still enforced by the
 * page gate and the queries beneath it, so the broad answer can only reveal
 * that a section exists, never data from a site the user has lost.
 */
export function viewerCan(
  viewer: ViewerPermissionContext,
  module: PlatformModule,
  verb: PermissionVerb,
  siteId?: string,
): boolean {
  if (!permits(viewer.role, module, verb)) return false;
  if (siteId) return effectiveVerbs(viewer, module, siteId).includes(verb);
  if (viewer.siteIds.length === 0) return true; // nothing to narrow against yet
  return viewer.siteIds.some((id) =>
    effectiveVerbs(viewer, module, id).includes(verb),
  );
}

/**
 * The sites where the viewer may perform `verb` on `module` — the access
 * boundary for that module, replacing a bare `viewer.siteIds` in module queries
 * so the exclusion happens IN the query rather than after the rows are read.
 */
export function viewerSiteIdsFor(
  viewer: ViewerPermissionContext,
  module: PlatformModule,
  verb: PermissionVerb = 'view',
): string[] {
  if (!permits(viewer.role, module, verb)) return [];
  return viewer.siteIds.filter((id) =>
    effectiveVerbs(viewer, module, id).includes(verb),
  );
}
