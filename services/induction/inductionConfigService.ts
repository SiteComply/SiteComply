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
  /** SC-011: whether a digital signature is required to complete the induction. */
  signatureRequired: boolean;
  /** Phase 3: whether the published induction video must be watched through. */
  videoRequired: boolean;
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
      inductionSignatureRequired: true,
      inductionVideoRequired: true,
    },
  });
  return {
    inductionValidityDays: row?.inductionValidityDays ?? null,
    inductionsInvalidatedAt: row?.inductionsInvalidatedAt
      ? row.inductionsInvalidatedAt.toISOString()
      : null,
    invalidatedByName: row?.invalidatedByName ?? null,
    signatureRequired: row?.inductionSignatureRequired ?? false,
    videoRequired: row?.inductionVideoRequired ?? false,
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
 * Set whether a full induction at this site requires a digital signature to
 * complete (SC-011). Ships dark: false = the pre-SC-011 tick-box completion.
 */
export async function saveSignatureRequired(
  viewer: PlatformViewer,
  siteId: string,
  required: boolean,
): Promise<ValidityResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const data = {
    inductionSignatureRequired: required,
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
 * Set whether the published induction video must be WATCHED THROUGH before an
 * induction at this site can be completed.
 *
 * Ships dark, like the signature. A site adopts the video when it is ready to;
 * turning this on before a video is published would simply have no effect, since
 * the gate only applies when there is something published to watch.
 */
export async function saveVideoRequired(
  viewer: PlatformViewer,
  siteId: string,
  required: boolean,
): Promise<ValidityResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const data = {
    inductionVideoRequired: required,
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
