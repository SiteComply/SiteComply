/**
 * Client-safe constants + pure helpers for GPS check-in validation (SC-007).
 * No Prisma / server imports, so the worker UI, the manager config UI and the
 * server validator share one source of truth.
 */

/** Default permitted check-in radius when a site enables GPS without setting one. */
export const DEFAULT_CHECKIN_RADIUS_M = 100;

/** Bounds for a configurable radius. */
export const RADIUS_MIN_M = 10;
export const RADIUS_MAX_M = 5000;

export const RADIUS_PRESETS_M = [50, 100, 250, 500];

/**
 * A fix worse than this (accuracy radius, metres) is treated as "poor accuracy":
 * we don't reject the worker as out-of-range, we ask them to retry. Chosen to
 * roughly match the default radius so a fuzzy fix can't masquerade as precise.
 */
export const POOR_ACCURACY_M = 100;

/** Clamp a radius into the allowed range, or null to clear. */
export function clampRadiusM(m: number | null | undefined): number | null {
  if (m == null || !Number.isFinite(m)) return null;
  return Math.min(Math.max(Math.round(m), RADIUS_MIN_M), RADIUS_MAX_M);
}

/** Basic sanity check for decimal-degree coordinates. */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Great-circle distance in metres between two lat/lng points (haversine).
 * Accurate to well within the metre-scale radii we care about.
 */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Round a metre distance for display. */
export function formatMetres(m: number): string {
  return `${Math.round(m)} metres`;
}
