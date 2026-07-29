'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SC-016 — live in-app notification delivery (Phase A).
 *
 * REV-1 reported that notifications "only appeared when the page was refreshed or
 * changed". That is inherent to the current design: the badge is produced by
 * PlatformShell, a server component, so nothing can change without a re-render.
 * This poller asks a cheap count endpoint on an interval and calls
 * `router.refresh()` only when the number actually MOVES — so a quiet system
 * costs one small query per interval and never re-renders the page.
 *
 * Deliberately not a websocket or SSE: production runs a single Burstable B1
 * instance, and a 60s poll is far simpler to reason about at pilot scale. True
 * Web Push (service worker + VAPID), which would also reach a closed app, is a
 * later phase.
 */
const POLL_MS = 60_000;

export function NotificationPoller({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const lastCount = useRef(initialCount);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      // Don't poll a backgrounded tab — it can't be read, and it wastes a query
      // per user per interval.
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch('/api/platform/notifications/count', {
            cache: 'no-store',
          });
          if (!cancelled && res.ok) {
            const data = (await res.json()) as { ok: boolean; count: number };
            if (data.ok && data.count !== lastCount.current) {
              lastCount.current = data.count;
              router.refresh();
            }
          }
        } catch {
          // Network blips are expected on site; the next tick retries.
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);

    // Coming back to the tab is the moment a stale badge is most visible, so
    // check immediately rather than waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
