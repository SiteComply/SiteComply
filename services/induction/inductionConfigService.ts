import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { clampValidityDays } from '@/services/induction/validityConstants';

/**
 * Site-manager controls for induction validity (SC-006), on the shared
 * SiteInductionConfig row. Gated on the `sites` "edit" permission (site managers
 * included) and the site being in the viewer's scope. These writes touch only the
 * validity/invalidation columns, so they never disturb the SC-005 knowledge-check
 * settings on the same row.
 */

export interface StoredInductionValidity {
  inductionValidityDays: number | null;
  inductionsInvalidatedAt: string | null;
  invalidatedByName: string | null;
}

export async function getValidityForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<StoredInductionValidity | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const row = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
    select: {
      inductionValidityDays: true,
      inductionsInvalidatedAt: true,
      invalidatedByName: true,
    },
  });
  return {
    inductionValidityDays: row?.inductionValidityDays ?? null,
    inductionsInvalidatedAt: row?.inductionsInvalidatedAt
      ? row.inductionsInvalidatedAt.toISOString()
      : null,
    invalidatedByName: row?.invalidatedByName ?? null,
  };
}

export type ValidityResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid' };

function canManage(viewer: PlatformViewer, siteId: string): boolean {
  return (
    permits(viewer.role, 'sites', 'edit') && viewer.siteIds.includes(siteId)
  );
}

/**
 * Set the site's induction validity period, in days. `null` clears it → the
 * worker re-inducts on every check-in (feature off for the site).
 */
export async function saveValidity(
  viewer: PlatformViewer,
  siteId: string,
  days: number | null,
): Promise<ValidityResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const value = clampValidityDays(days);
  const data = {
    inductionValidityDays: value,
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };
  await prisma.siteInductionConfig.upsert({
    where: { jobSiteId: siteId },
    create: { jobSiteId: siteId, ...data },
    update: data,
  });
  return { ok: true };
}

/**
 * Invalidate previous inductions for a site (SC-006). Stamps the cutoff to now,
 * so every induction completed at/before this instant is treated as expired and
 * every worker must complete the latest induction before their next check-in.
 */
export async function invalidateInductions(
  viewer: PlatformViewer,
  siteId: string,
): Promise<ValidityResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const data = {
    inductionsInvalidatedAt: new Date(),
    invalidatedByName: viewer.name,
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };
  await prisma.siteInductionConfig.upsert({
    where: { jobSiteId: siteId },
    create: { jobSiteId: siteId, ...data },
    update: data,
  });
  return { ok: true };
}
