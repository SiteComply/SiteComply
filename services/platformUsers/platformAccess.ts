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
  /**
   * SC-022 — per-site permission overrides NARROWING the role baseline.
   * Keyed siteId → module → retained verbs. Only overridden entries appear;
   * absence means the role baseline applies unchanged.
   */
  overrides: SiteOverrides;
  /** SC-022 Phase 2 — the company-wide floor applying to this user. */
  companyDefaults: PermissionOverride;
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

    // SC-022 — one extra query per request, inside the same cached resolver, so
    // every gate in the app sees the same effective permissions without any
    // call site having to remember to look them up.
    //
    // A DIRECTOR is never narrowed: they are the only all-sites role, and an
    // organisation that can lock its own Directors out of the platform has no
    // way back in. Skipping the query for them is also the common case.
    const overrides: SiteOverrides = {};
    const companyDefaults: PermissionOverride = {};
    if (role !== 'DIRECTOR') {
      const [rows, companyRows] = await Promise.all([
        prisma.siteUserPermission.findMany({
          where: { platformUserId: user.id },
          select: { jobSiteId: true, module: true, verbs: true },
        }),
        // SC-022 Phase 2 — a LIVE rule, read every request, so it covers people
        // added to the company after it was set.
        prisma.companyPermissionDefault.findMany({
          where: { company: user.company },
          select: { module: true, verbs: true },
        }),
      ]);
      for (const r of rows) {
        if (!isPlatformModule(r.module)) continue;
        (overrides[r.jobSiteId] ??= {})[r.module] = r.verbs as PermissionVerb[];
      }
      for (const r of companyRows) {
        if (!isPlatformModule(r.module)) continue;
        companyDefaults[r.module] = r.verbs as PermissionVerb[];
      }
    }

    return {
      id: user.id,
      name: user.name,
      company: user.company,
      role,
      allSites,
      siteIds: sites.map((s) => s.id),
      sites,
      overrides,
      companyDefaults,
    };
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
