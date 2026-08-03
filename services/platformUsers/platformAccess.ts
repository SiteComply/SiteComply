import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPlatformSession } from '@/lib/session';
import {
  roleHasAllSites,
  permits,
  isPlatformModule,
  PERMISSION_VERBS,
  type PlatformModule,
  type PermissionVerb,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import type {
  SiteOverrides,
  PermissionOverride,
} from '@/services/platformUsers/contractorAccessConstants';
import { viewerCan as viewerCanImpl } from '@/services/platformUsers/effectivePermissions';

/**
 * Assigned-Sites enforcement for Platform Login users.
 *
 * Resolves the signed-in platform user and the set of sites they may see:
 *  - Directors see ALL sites (organisation-wide).
 *  - Every other role sees ONLY their Assigned Sites.
 * Non-assigned sites are excluded entirely (`siteIds`), so any site-scoped query
 * built from `siteIds` cannot surface them.
 *
 * This enforces the site boundary ONLY. Role-based permissions (what a role may
 * view/create/edit/export) are NOT enforced here yet.
 */

// Viewer types + the site column set now live in platformViewerTypes.ts so they
// can be used outside a request (see viewerBuilder.ts). Re-exported here because
// this is where the rest of the app already imports them from.
export type {
  ViewerSite,
  PlatformViewer,
} from '@/services/platformUsers/platformViewerTypes';
export { SITE_FIELDS } from '@/services/platformUsers/platformViewerTypes';

export { buildViewerForUser } from '@/services/platformUsers/viewerBuilder';

// Imported (not just re-exported) because the session resolver below uses them.
import type { PlatformViewer } from '@/services/platformUsers/platformViewerTypes';
import {
  findUserForViewer,
  buildViewerFromUser,
} from '@/services/platformUsers/viewerBuilder';

/**
 * The current platform viewer, or null if not signed in or no longer ACTIVE.
 * Status and assigned sites are re-read from the DB on every request, so
 * disabling a user or changing their assignments takes effect immediately.
 * Cached per request so the layout, shell and page share one lookup.
 */
export const getPlatformViewer = cache(
  async (): Promise<PlatformViewer | null> => {
    const session = getPlatformSession();
    if (!session) return null;

    const user = await findUserForViewer(session.userId);
    if (!user || user.status !== 'ACTIVE') return null;
    return buildViewerFromUser(user);
  },
);

/** Require a signed-in platform viewer; redirect to Platform Login otherwise. */
export async function requirePlatformViewer(): Promise<PlatformViewer> {
  const viewer = await getPlatformViewer();
  if (!viewer) redirect('/platform');
  return viewer;
}

// SC-022 — effective permission resolution lives in effectivePermissions.ts so
// it stays pure and independently testable; re-exported here because this is
// where callers already look for viewer helpers.
export {
  effectiveVerbs,
  viewerCan,
  viewerSiteIdsFor,
} from '@/services/platformUsers/effectivePermissions';

/**
 * Require that the viewer may VIEW `module`; redirect to the dashboard otherwise.
 *
 * SC-022: now answers against EFFECTIVE permissions rather than the role alone,
 * so narrowing a contractor's audits access closes all 80-odd module pages at
 * once instead of each page needing to remember. "On any assigned site" is the
 * gate; the site-scoped queries inside each page do the rest.
 */
export function assertModuleView(
  viewer: PlatformViewer,
  module: PlatformModule,
): void {
  if (!viewerCanImpl(viewer, module, 'view')) redirect('/platform/dashboard');
}

/** A short human description of a viewer's site access, for headers/badges. */
export function describeScope(viewer: PlatformViewer): string {
  if (viewer.allSites) {
    return `Organisation-wide · all ${viewer.sites.length} site${
      viewer.sites.length === 1 ? '' : 's'
    }`;
  }
  const n = viewer.siteIds.length;
  return n === 0
    ? 'No sites assigned yet'
    : `${n} assigned site${n === 1 ? '' : 's'}`;
}
