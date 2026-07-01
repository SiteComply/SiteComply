import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPlatformSession } from '@/lib/session';
import {
  roleHasAllSites,
  permits,
  type PlatformModule,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

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

export interface ViewerSite {
  id: string;
  name: string;
  jobReference: string;
  town: string;
  postcode: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface PlatformViewer {
  id: string;
  name: string;
  company: string;
  role: PlatformRoleValue;
  /** True for Director — sees all sites and ignores Assigned Sites. */
  allSites: boolean;
  /** Ids of every site the viewer may see (the access boundary). */
  siteIds: string[];
  /** The sites the viewer may see, for listing. */
  sites: ViewerSite[];
}

const SITE_FIELDS = {
  id: true,
  name: true,
  jobReference: true,
  town: true,
  postcode: true,
  status: true,
} as const;

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

    const user = await prisma.platformUser.findUnique({
      where: { id: session.userId },
      include: { assignedSites: { select: SITE_FIELDS } },
    });
    if (!user || user.status !== 'ACTIVE') return null;

    const role = user.role as PlatformRoleValue;
    const allSites = roleHasAllSites(role);

    const sites: ViewerSite[] = allSites
      ? await prisma.jobSite.findMany({
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          select: SITE_FIELDS,
        })
      : [...user.assignedSites].sort((a, b) => a.name.localeCompare(b.name));

    return {
      id: user.id,
      name: user.name,
      company: user.company,
      role,
      allSites,
      siteIds: sites.map((s) => s.id),
      sites,
    };
  },
);

/** Require a signed-in platform viewer; redirect to Platform Login otherwise. */
export async function requirePlatformViewer(): Promise<PlatformViewer> {
  const viewer = await getPlatformViewer();
  if (!viewer) redirect('/platform');
  return viewer;
}

/**
 * Require that the viewer may VIEW `module`; redirect to the dashboard otherwise.
 * Enforced for Director/Project Manager/Client; other roles are unchanged (all
 * three enforced roles can currently view every module, so this blocks nothing
 * for them yet, but the gate is in place for future modules/roles).
 */
export function assertModuleView(
  viewer: PlatformViewer,
  module: PlatformModule,
): void {
  if (!permits(viewer.role, module, 'view')) redirect('/platform/dashboard');
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
