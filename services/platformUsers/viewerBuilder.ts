import { prisma } from '@/lib/prisma';
import {
  isPlatformModule,
  roleHasAllSites,
  type PermissionVerb,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import type { PermissionOverride } from '@/services/platformUsers/contractorAccessConstants';
import type {
  PlatformViewer,
  SiteOverrides,
  ViewerSite,
} from '@/services/platformUsers/platformViewerTypes';
import { SITE_FIELDS } from '@/services/platformUsers/platformViewerTypes';

/**
 * Building a PlatformViewer from a user row.
 *
 * This lives OUTSIDE platformAccess.ts on purpose. That module wraps the session
 * viewer in React's `cache()`, which only exists inside a request — importing it
 * from a script or a non-request context throws "cache is not a function". SC-024
 * Phase 3 resolves a viewer for a share link and is exercised by tests that run
 * under tsx, so the logic has to sit somewhere request-independent. Same lesson
 * as SC-022's effectivePermissions.ts.
 */

/** One definition of the user row both viewer builders work from. */
export function findUserForViewer(id: string) {
  return prisma.platformUser.findUnique({
    where: { id },
    include: { assignedSites: { select: SITE_FIELDS } },
  });
}
type PlatformUserWithSites = NonNullable<
  Awaited<ReturnType<typeof findUserForViewer>>
>;

/**
 * Build a viewer for a specific user id, independent of the session.
 *
 * SC-024 Phase 3 needs this: a shared close-out pack link is opened by someone
 * with no session at all, and the pack must be rendered under the permissions of
 * the person who shared it. Reading those permissions LIVE (rather than
 * snapshotting them when the link was created) is what makes "preserve existing
 * permission controls" true — deactivate the sharer, or narrow their access, and
 * the link immediately stops showing what they can no longer see.
 *
 * Returns null when the user no longer exists or is not ACTIVE.
 */
export async function buildViewerForUser(
  userId: string,
): Promise<PlatformViewer | null> {
  const user = await findUserForViewer(userId);
  if (!user || user.status !== 'ACTIVE') return null;
  return buildViewerFromUser(user);
}

/** The shared body of both viewer builders — one definition of "effective access". */
export async function buildViewerFromUser(
  user: PlatformUserWithSites,
): Promise<PlatformViewer> {
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
}
