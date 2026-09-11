/**
 * Send one client-side failure to the server. Browser-only.
 *
 * `sendBeacon` first: a crash is very often followed by the user navigating or
 * closing the tab, and a normal fetch is cancelled when that happens — which is
 * exactly the report we most want. `keepalive` fetch is the fallback for
 * browsers that refuse a beacon with a JSON content type.
 *
 * Never throws. This runs inside error handlers.
 */
export interface ClientErrorReport {
  kind: 'CLIENT_RENDER' | 'CLIENT_UNCAUGHT' | 'CLIENT_REJECTION' | 'SERVER_RENDER';
  name?: string | null;
  message: string;
  stack?: string | null;
  /** Next's error.digest — present when the failure began on the server. */
  digest?: string | null;
}

const MAX_STACK = 8_000;

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return;
    const body = JSON.stringify({
      kind: report.kind,
      name: report.name ?? null,
      message: String(report.message ?? '').slice(0, 2_000),
      stack: report.stack ? String(report.stack).slice(0, MAX_STACK) : null,
      digest: report.digest ?? null,
      // PATH ONLY. `location.href` would carry the query string, which on these
      // screens holds operative names and date ranges.
      pagePath: window.location.pathname,
      pageTitle: document.title || null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    const url = '/api/telemetry/error';
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    /* reporting a failure must never add one */
  }
}
