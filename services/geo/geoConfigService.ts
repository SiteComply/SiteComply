import { GpsUnavailablePolicy } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { clampRadiusM, isValidLatLng } from '@/services/geo/geoConstants';

/**
 * Site-manager controls for GPS check-in validation (SC-007). GPS config lives on
 * JobSite; overrides live in CheckInOverride. All gated on the `sites` "edit"
 * permission (site managers included) and the site being in the viewer's scope.
 */

export interface StoredGpsConfig {
  gpsCheckInEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  checkInRadiusM: number | null;
  gpsUnavailablePolicy: GpsUnavailablePolicy;
}

export async function getGpsConfigForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<StoredGpsConfig | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: {
      gpsCheckInEnabled: true,
      latitude: true,
      longitude: true,
      checkInRadiusM: true,
      gpsUnavailablePolicy: true,
    },
  });
  return {
    gpsCheckInEnabled: site?.gpsCheckInEnabled ?? false,
    latitude: site?.latitude ?? null,
    longitude: site?.longitude ?? null,
    checkInRadiusM: site?.checkInRadiusM ?? null,
    gpsUnavailablePolicy: site?.gpsUnavailablePolicy ?? 'BLOCK',
  };
}

export interface GpsConfigInput {
  gpsCheckInEnabled?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  checkInRadiusM?: number | null;
  gpsUnavailablePolicy?: string;
}

export type GpsResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid' };

function canManage(viewer: PlatformViewer, siteId: string): boolean {
  return (
    permits(viewer.role, 'sites', 'edit') && viewer.siteIds.includes(siteId)
  );
}

export async function saveGpsConfig(
  viewer: PlatformViewer,
  siteId: string,
  input: GpsConfigInput,
): Promise<GpsResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  // Coordinates must be a valid pair or both cleared.
  const lat = input.latitude ?? null;
  const lng = input.longitude ?? null;
  if ((lat === null) !== (lng === null))
    return { ok: false, reason: 'invalid' };
  if (lat !== null && lng !== null && !isValidLatLng(lat, lng)) {
    return { ok: false, reason: 'invalid' };
  }

  let policy: GpsUnavailablePolicy | undefined;
  if (typeof input.gpsUnavailablePolicy === 'string') {
    if (
      input.gpsUnavailablePolicy !== 'BLOCK' &&
      input.gpsUnavailablePolicy !== 'ALLOW_FLAGGED'
    ) {
      return { ok: false, reason: 'invalid' };
    }
    policy = input.gpsUnavailablePolicy;
  }

  await prisma.jobSite.update({
    where: { id: siteId },
    data: {
      gpsCheckInEnabled: input.gpsCheckInEnabled ?? false,
      latitude: lat,
      longitude: lng,
      checkInRadiusM: clampRadiusM(input.checkInRadiusM),
      ...(policy ? { gpsUnavailablePolicy: policy } : {}),
    },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export interface SiteWorkerOption {
  workerId: string;
  fullName: string;
  company: string;
}

/** Workers with recent attendance at the site — candidates for an override. */
export async function listRecentWorkersForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteWorkerOption[]> {
  if (!viewer.siteIds.includes(siteId)) return [];
  const subs = await prisma.submission.findMany({
    where: { jobSiteId: siteId },
    orderBy: { checkedInAt: 'desc' },
    take: 50,
    select: { worker: { select: { id: true, fullName: true, company: true } } },
  });
  const seen = new Set<string>();
  const out: SiteWorkerOption[] = [];
  for (const s of subs) {
    if (seen.has(s.worker.id)) continue;
    seen.add(s.worker.id);
    out.push({
      workerId: s.worker.id,
      fullName: s.worker.fullName,
      company: s.worker.company,
    });
  }
  return out;
}

export interface OverrideRow {
  id: string;
  workerName: string;
  company: string;
  reason: string;
  grantedByName: string | null;
  createdAtLabel: string;
  expiresAtLabel: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

/** Recent overrides for the site (active first). */
export async function listOverridesForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<
  Array<
    Omit<OverrideRow, 'createdAtLabel' | 'expiresAtLabel'> & {
      createdAt: Date;
      expiresAt: Date | null;
    }
  >
> {
  if (!viewer.siteIds.includes(siteId)) return [];
  const rows = await prisma.checkInOverride.findMany({
    where: { jobSiteId: siteId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { worker: { select: { fullName: true, company: true } } },
  });
  const now = Date.now();
  return rows.map((r) => {
    let status: OverrideRow['status'] = 'active';
    if (r.revokedAt) status = 'revoked';
    else if (r.usedAt) status = 'used';
    else if (r.expiresAt && r.expiresAt.getTime() <= now) status = 'expired';
    return {
      id: r.id,
      workerName: r.worker.fullName,
      company: r.worker.company,
      reason: r.reason,
      grantedByName: r.grantedByName,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status,
    };
  });
}

export type OverrideResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid' };

/** Grant an off-site check-in override (reason MANDATORY for audit). */
export async function grantOverride(
  viewer: PlatformViewer,
  siteId: string,
  workerId: string,
  reason: string,
  expiresAt: Date | null,
): Promise<OverrideResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 3) return { ok: false, reason: 'invalid' };

  // The worker must have attendance at this site (in the viewer's scope).
  const known = await prisma.submission.findFirst({
    where: { jobSiteId: siteId, workerId },
    select: { id: true },
  });
  if (!known) return { ok: false, reason: 'not_found' };

  const created = await prisma.checkInOverride.create({
    data: {
      workerId,
      jobSiteId: siteId,
      reason: trimmed.slice(0, 500),
      grantedByUserId: viewer.id,
      grantedByName: viewer.name,
      expiresAt,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Revoke an override that hasn't been used yet. Viewer-scoped. */
export async function revokeOverride(
  viewer: PlatformViewer,
  overrideId: string,
): Promise<OverrideResult> {
  if (!permits(viewer.role, 'sites', 'edit'))
    return { ok: false, reason: 'forbidden' };
  const found = await prisma.checkInOverride.findFirst({
    where: {
      id: overrideId,
      jobSiteId: { in: viewer.siteIds },
      usedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!found) return { ok: false, reason: 'not_found' };
  await prisma.checkInOverride.update({
    where: { id: overrideId },
    data: { revokedAt: new Date() },
  });
  return { ok: true, id: overrideId };
}
