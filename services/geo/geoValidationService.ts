import { GpsUnavailablePolicy } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_CHECKIN_RADIUS_M,
  POOR_ACCURACY_M,
  haversineMetres,
  isValidLatLng,
} from '@/services/geo/geoConstants';

/**
 * Server-side GPS check-in validation (SC-007).
 *
 * The worker's browser supplies a location fix; the server is authoritative — it
 * recomputes the distance from the site's stored coordinates and decides whether
 * a check-in may proceed. Nothing trusts a client "verified" flag.
 *
 * A site has GPS validation only when a manager has enabled it AND set
 * coordinates; otherwise the feature is off for that site (ships dark), and a
 * misconfigured site (enabled but no coordinates) is treated as off so a worker
 * is never trapped.
 */

/** A location fix from the worker's device, or an explicit "no fix". */
export type LocationFix =
  | { lat: number; lng: number; accuracyM: number }
  | { unavailable: true; reason?: string };

export interface SiteGps {
  enabled: boolean; //     true only when enabled AND coordinates are set
  lat: number | null;
  lng: number | null;
  radiusM: number;
  unavailablePolicy: GpsUnavailablePolicy;
}

/** The site's effective GPS config (feature off unless enabled + coordinates set). */
export async function getSiteGps(siteId: string): Promise<SiteGps> {
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
  const hasCoords = isValidLatLng(site?.latitude, site?.longitude);
  return {
    enabled: Boolean(site?.gpsCheckInEnabled && hasCoords),
    lat: site?.latitude ?? null,
    lng: site?.longitude ?? null,
    radiusM: site?.checkInRadiusM ?? DEFAULT_CHECKIN_RADIUS_M,
    unavailablePolicy: site?.gpsUnavailablePolicy ?? 'BLOCK',
  };
}

export type LocationState =
  | 'off' //            no GPS validation for this site
  | 'verified' //       inside the radius with a trustworthy fix
  | 'outside' //        genuinely outside the radius
  | 'poor_accuracy' //  the fix is too fuzzy to trust either way — retry
  | 'unavailable'; //   no fix at all

export interface LocationEvaluation {
  state: LocationState;
  distanceM: number | null;
  accuracyM: number | null;
  radiusM: number;
}

/**
 * Classify a fix against a site's GPS config, for the worker UI. Pure given the
 * config. `verified` requires a fix that is BOTH reasonably accurate and inside
 * the radius (allowing the accuracy margin); a fuzzy fix is `poor_accuracy`, not
 * silently "inside", so an imprecise reading can't masquerade as on-site.
 */
export function evaluateFix(
  gps: SiteGps,
  fix: LocationFix,
): LocationEvaluation {
  if (!gps.enabled || gps.lat == null || gps.lng == null) {
    return {
      state: 'off',
      distanceM: null,
      accuracyM: null,
      radiusM: gps.radiusM,
    };
  }
  if ('unavailable' in fix) {
    return {
      state: 'unavailable',
      distanceM: null,
      accuracyM: null,
      radiusM: gps.radiusM,
    };
  }
  const distanceM = haversineMetres(gps.lat, gps.lng, fix.lat, fix.lng);
  const accuracyM = fix.accuracyM;
  if (accuracyM > POOR_ACCURACY_M) {
    return {
      state: 'poor_accuracy',
      distanceM,
      accuracyM,
      radiusM: gps.radiusM,
    };
  }
  const inside = distanceM - accuracyM <= gps.radiusM;
  return {
    state: inside ? 'verified' : 'outside',
    distanceM,
    accuracyM,
    radiusM: gps.radiusM,
  };
}

/** A currently-valid, unused, unrevoked, unexpired override for this worker+site. */
export async function findValidOverride(workerId: string, siteId: string) {
  return prisma.checkInOverride.findFirst({
    where: {
      workerId,
      jobSiteId: siteId,
      usedAt: null,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, reason: true, grantedByName: true },
  });
}

/** Location fields to write onto a Submission for a check-in. */
export interface LocationRecord {
  checkInLat?: number;
  checkInLng?: number;
  checkInAccuracyM?: number;
  checkInDistanceM?: number;
  locationVerified: boolean;
  gpsUnavailable: boolean;
  locationOverridden: boolean;
  overrideByName?: string | null;
  overrideReason?: string | null;
}

export type GateResult =
  | { allow: true; record: LocationRecord; consumeOverrideId: string | null }
  | {
      allow: false;
      reason: 'outside' | 'unavailable' | 'poor_accuracy';
      distanceM: number | null;
      radiusM: number;
    };

/**
 * The authoritative check-in gate for a site with GPS validation. Given the
 * worker's fix, decides whether the check-in may proceed and the exact location
 * fields to record:
 *  - verified            → allow, locationVerified;
 *  - outside/poor        → allow ONLY with a valid manager override, else deny;
 *  - no fix (unavailable)→ allow with an override; otherwise the site policy:
 *                          ALLOW_FLAGGED records gpsUnavailable, BLOCK denies.
 * A consumed override id is returned so the caller can stamp it used in the same
 * transaction as the check-in.
 */
export async function evaluateCheckInGate(
  siteId: string,
  workerId: string,
  fix: LocationFix,
): Promise<
  | {
      allow: true;
      record: LocationRecord;
      consumeOverrideId: string | null;
      gpsEnabled: boolean;
    }
  | {
      allow: false;
      reason: 'outside' | 'unavailable' | 'poor_accuracy';
      distanceM: number | null;
      radiusM: number;
    }
> {
  const gps = await getSiteGps(siteId);
  if (!gps.enabled) {
    return {
      allow: true,
      gpsEnabled: false,
      consumeOverrideId: null,
      record: {
        locationVerified: false,
        gpsUnavailable: false,
        locationOverridden: false,
      },
    };
  }

  const evalResult = evaluateFix(gps, fix);
  const hasCoords = !('unavailable' in fix);
  const base: Partial<LocationRecord> = hasCoords
    ? {
        checkInLat: (fix as { lat: number }).lat,
        checkInLng: (fix as { lng: number }).lng,
        checkInAccuracyM: (fix as { accuracyM: number }).accuracyM,
        checkInDistanceM: evalResult.distanceM ?? undefined,
      }
    : {};

  if (evalResult.state === 'verified') {
    return {
      allow: true,
      gpsEnabled: true,
      consumeOverrideId: null,
      record: {
        ...base,
        locationVerified: true,
        gpsUnavailable: false,
        locationOverridden: false,
      },
    };
  }

  // Not verified (outside / poor accuracy / no fix): a manager override lets the
  // worker in from anywhere, recording who authorised it and why.
  const override = await findValidOverride(workerId, siteId);
  if (override) {
    return {
      allow: true,
      gpsEnabled: true,
      consumeOverrideId: override.id,
      record: {
        ...base,
        locationVerified: false,
        gpsUnavailable: evalResult.state === 'unavailable',
        locationOverridden: true,
        overrideByName: override.grantedByName,
        overrideReason: override.reason,
      },
    };
  }

  // No override. A missing fix falls to the site policy; being outside / fuzzy
  // never auto-passes.
  if (
    evalResult.state === 'unavailable' &&
    gps.unavailablePolicy === 'ALLOW_FLAGGED'
  ) {
    return {
      allow: true,
      gpsEnabled: true,
      consumeOverrideId: null,
      record: {
        locationVerified: false,
        gpsUnavailable: true,
        locationOverridden: false,
      },
    };
  }

  return {
    allow: false,
    reason:
      evalResult.state === 'unavailable'
        ? 'unavailable'
        : evalResult.state === 'poor_accuracy'
          ? 'poor_accuracy'
          : 'outside',
    distanceM: evalResult.distanceM,
    radiusM: gps.radiusM,
  };
}

/** Check-out location fields (SC-007) — recorded, never blocks leaving site. */
export interface CheckOutLocation {
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutAccuracyM?: number;
  checkOutDistanceM?: number;
}

export async function computeCheckOutLocation(
  siteId: string,
  fix: LocationFix | null,
): Promise<CheckOutLocation> {
  if (!fix || 'unavailable' in fix) return {};
  const gps = await getSiteGps(siteId);
  const distanceM =
    gps.lat != null && gps.lng != null
      ? haversineMetres(gps.lat, gps.lng, fix.lat, fix.lng)
      : undefined;
  return {
    checkOutLat: fix.lat,
    checkOutLng: fix.lng,
    checkOutAccuracyM: fix.accuracyM,
    checkOutDistanceM: distanceM,
  };
}

/** Parse an untrusted request body into a LocationFix (or null if absent). */
export function parseLocationFix(body: unknown): LocationFix | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.gpsUnavailable === true || b.unavailable === true) {
    return {
      unavailable: true,
      reason: typeof b.reason === 'string' ? b.reason : undefined,
    };
  }
  if (isValidLatLng(b.lat, b.lng)) {
    const accuracyM =
      typeof b.accuracyM === 'number' &&
      Number.isFinite(b.accuracyM) &&
      b.accuracyM >= 0
        ? b.accuracyM
        : Number.POSITIVE_INFINITY; // unknown accuracy → treated as poor
    return { lat: b.lat as number, lng: b.lng as number, accuracyM };
  }
  return null;
}
