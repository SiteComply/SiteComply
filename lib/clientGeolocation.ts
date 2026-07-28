/**
 * Client-side geolocation capture (SC-007). Used for best-effort location on
 * check-out, where we record the worker's position but must NEVER block them
 * leaving site. Always resolves (never rejects); returns an explicit
 * `{ gpsUnavailable: true }` when no fix is obtained.
 */

export type CapturedLocation =
  | { lat: number; lng: number; accuracyM: number }
  | { gpsUnavailable: true };

/**
 * Capture a one-shot location. With `onlyIfGranted` (the default for check-out)
 * it will NOT trigger a fresh permission prompt — it captures only when the
 * worker has already granted location (e.g. because they checked in on a
 * GPS-validated site), otherwise resolves to unavailable. This keeps check-out
 * frictionless on sites that don't use GPS.
 */
export async function captureLocation(opts?: {
  onlyIfGranted?: boolean;
  timeoutMs?: number;
}): Promise<CapturedLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { gpsUnavailable: true };
  }
  if (opts?.onlyIfGranted && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({
        name: 'geolocation' as PermissionName,
      });
      if (status.state !== 'granted') return { gpsUnavailable: true };
    } catch {
      // Permissions API unavailable — fall through and attempt a capture.
    }
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      () => resolve({ gpsUnavailable: true }),
      {
        enableHighAccuracy: true,
        timeout: opts?.timeoutMs ?? 8000,
        maximumAge: 30000,
      },
    );
  });
}
