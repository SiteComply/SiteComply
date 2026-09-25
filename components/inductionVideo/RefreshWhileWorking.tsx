'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  WORK_POLL_CEILING_MS,
  WORK_POLL_INTERVAL_MS,
} from '@/services/inductionVideo/videoProgress';

/**
 * KEEPS A PAGE CURRENT WHILE A JOB IS RUNNING, then stops.
 *
 * The problem: generating a script queues a job that starts immediately and
 * finishes in seconds, but the page was server-rendered before it finished, so the
 * new version only appeared if you reloaded by hand. People reasonably read that
 * as "nothing happened".
 *
 * ── IT POLLS ONLY WHILE THERE IS WORK, AND STOPS BY ITSELF ────────────────
 *
 * `working` is computed on the server from the version's status. When the job
 * finishes, the next refresh renders with `working` false, this effect tears down,
 * and the polling ends without anything having to decide to stop it. That is the
 * whole design: no timer running on a settled page, and no "is it done yet" logic
 * duplicated on the client.
 *
 * The existing admin `AutoRefresh` was the alternative — a fixed 15-second timer
 * that never stops. Right for On Site Now, where the answer changes all day.
 * Wrong here, where it would either be too slow to feel like a response or would
 * poll a finished video forever.
 *
 * ── WHY POLLING RATHER THAN A LIVE CONNECTION ─────────────────────────────
 *
 * The work being waited on lasts seconds to a minute or two, and the server is a
 * single App Service instance. An SSE or WebSocket channel would need its own
 * lifecycle, its own reconnection and its own authorisation on both tiers, to
 * remove a three-second delay from something that happens a handful of times a
 * day. Revisit it if induction videos ever need a live queue view.
 *
 * ── A CEILING, BECAUSE A DEAD JOB WRITES NO FAILURE ───────────────────────
 *
 * If a job dies without recording a failure the status stays transient forever, so
 * the page would poll for as long as the tab is open. After the ceiling it stops
 * and says so, leaving a person a button rather than a spinner.
 *
 * Shared by both tiers and both screens — see videoProgress.ts for why the
 * definition of "working" is not written four times.
 */
export function RefreshWhileWorking({
  working,
  label,
}: {
  /** Server-computed: is a job in flight right now? */
  working: boolean;
  /** What is happening, e.g. "Writing the script". */
  label: string | null;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!working) {
      // Settled: forget any earlier wait so a later job starts its own clock.
      startedAt.current = null;
      setGaveUp(false);
      return;
    }
    if (gaveUp) return;

    startedAt.current ??= Date.now();
    const id = setInterval(() => {
      if (Date.now() - (startedAt.current ?? Date.now()) > WORK_POLL_CEILING_MS) {
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, WORK_POLL_INTERVAL_MS);

    // Coming back to the tab should show the truth immediately rather than
    // waiting out the rest of an interval.
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [working, gaveUp, router]);

  if (!working) return null;

  return (
    <p
      // Announced, because the whole point is that something is happening that
      // the person cannot see.
      role="status"
      aria-live="polite"
      className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-50 px-4 py-3 text-sm text-ink"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 animate-pulse rounded-full bg-brand-600"
      />
      <span className="font-semibold">{label ?? 'Working'}…</span>
      {gaveUp ? (
        <span className="text-ink-muted">
          This is taking longer than expected. It may still be running — check
          again, and the version’s history will show if it failed.
        </span>
      ) : (
        <span className="text-ink-muted">
          This page updates on its own when it finishes. You do not need to
          reload it.
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setGaveUp(false);
          startedAt.current = Date.now();
          router.refresh();
        }}
        className="ml-auto font-semibold text-brand-700 hover:underline"
      >
        Check now
      </button>
    </p>
  );
}
