'use client';

import { useEffect } from 'react';
import { reportClientError } from './reportClientError';

/**
 * Catches the browser failures React's error boundaries never see.
 *
 * An error boundary only covers errors thrown while RENDERING. A failure inside
 * an event handler, a timer, or a rejected promise walks straight past it — the
 * page looks fine, the button does nothing, and nothing is recorded anywhere.
 * These two listeners are the only way those reach us.
 *
 * Mounted once in the root layout so it covers all three portals and the public
 * pages. Renders nothing.
 */
export function ErrorTelemetry() {
  useEffect(() => {
    // One page can fail many times in a second — a render loop, a broken
    // interval. The server deduplicates too, but there is no reason to send the
    // same thing a hundred times to find that out.
    const recent = new Map<string, number>();
    const tooSoon = (key: string) => {
      const now = Date.now();
      const last = recent.get(key);
      if (last && now - last < 10_000) return true;
      recent.set(key, now);
      if (recent.size > 50) recent.clear();
      return false;
    };

    function onError(event: ErrorEvent) {
      const err = event.error as Error | undefined;
      const message = err?.message ?? event.message ?? 'Unknown error';
      // Cross-origin scripts report a bare "Script error." with no detail.
      // Recording those would fill the log with rows nobody can act on.
      if (!err && /^script error/i.test(message)) return;
      if (tooSoon(`e:${message}`)) return;
      reportClientError({
        kind: 'CLIENT_UNCAUGHT',
        name: err?.name ?? 'Error',
        message,
        stack: err?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`,
      });
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as unknown;
      const err = reason instanceof Error ? reason : null;
      const message = err?.message ?? String(reason ?? 'Unhandled rejection');
      if (tooSoon(`r:${message}`)) return;
      reportClientError({
        kind: 'CLIENT_REJECTION',
        name: err?.name ?? 'UnhandledRejection',
        message,
        stack: err?.stack ?? null,
      });
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
