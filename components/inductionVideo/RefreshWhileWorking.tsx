'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  WORK_POLL_CEILING_MS,
  WORK_POLL_INTERVAL_MS,
  workPollDelayMs,
} from '@/services/inductionVideo/videoProgress';

/**
 * KEEPS A PAGE CURRENT WHILE A JOB IS RUNNING, then stops.
 *
 * The problem: generating a script, narrating it or rendering it queues a job that
 * starts immediately, but the page was server-rendered before the job finished, so
 * the result only appeared if you reloaded by hand. People reasonably read that as
 * "nothing happened".
 *
 * ── IT ASKS A CHEAP QUESTION AND ONLY THEN RE-RENDERS ─────────────────────
 *
 * The first version of this called `router.refresh()` on every tick, which
 * re-renders the whole page on the server: the version with its scenes, jobs and
 * events, the views, the spend, the module overrides, a narration estimate. Every
 * three seconds. Through a 123-second render that is about forty of them, and the
 * renderer runs IN THE SAME PROCESS on one small instance - so those renders queued
 * behind ffmpeg and competed with it. The streamed React payload was truncated
 * under the load and the client threw `TypeError: Error in input stream`, which
 * trips the error boundary: polling was CRASHING the page it was keeping fresh
 * (production, 2026-09-29, SC-E-00009).
 *
 * So each tick now fetches a small JSON fingerprint instead, and calls
 * `router.refresh()` only when that fingerprint has actually changed - twice in a
 * typical run rather than forty times for nothing. The fingerprint covers the
 * per-scene narration audio as well as the status, so a scene landing shows up on
 * its own, which is what makes the wait feel alive without re-rendering for it.
 *
 * ── IT SURVIVES A FAILED POLL ─────────────────────────────────────────────
 *
 * A poll that fails is a reason to try again, never a reason to throw: an
 * unhandled rejection here would put the page on the error screen for a blip, which
 * is the failure this component is supposed to prevent. Failures are counted and
 * reported quietly; only a long run of them gives up.
 *
 * ── IT BACKS OFF ──────────────────────────────────────────────────────────
 *
 * A script takes seconds and a render takes minutes, so a fixed beat is either too
 * slow to feel responsive or far too eager an hour into a long job. See
 * `workPollDelayMs`.
 *
 * ── WHY POLLING RATHER THAN A LIVE CONNECTION ─────────────────────────────
 *
 * The work lasts seconds to a couple of minutes on a single App Service instance.
 * An SSE or WebSocket channel would need its own lifecycle, reconnection and
 * authorisation in both tiers; a request this small, a handful of times a day, is
 * the cheaper correct answer. Revisit it if induction videos ever need a live queue.
 *
 * ── A CEILING, BECAUSE A DEAD JOB WRITES NO FAILURE ───────────────────────
 *
 * If a job dies without recording a failure the status stays transient forever, so
 * this would poll for as long as the tab is open. After the ceiling it stops and
 * says so, leaving a person a button rather than a spinner.
 */
export function RefreshWhileWorking({
  working,
  label,
  statusHref,
}: {
  /** Server-computed on the last render: was a job in flight then? */
  working: boolean;
  /** What is happening, e.g. "Writing the script". */
  label: string | null;
  /**
   * The cheap status endpoint for this page, e.g.
   * `/api/platform/induction-video/<id>/status`. Required: without it the only way
   * to detect a change would be the whole-page re-render this exists to avoid.
   */
  statusHref: string;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  /** What the server last told us, so a tick can tell "changed" from "the same". */
  const [live, setLive] = useState<{ working: boolean; label: string | null } | null>(null);
  const [stalePoll, setStalePoll] = useState(false);

  const startedAt = useRef<number | null>(null);
  const fingerprint = useRef<string | null>(null);
  const failures = useRef(0);
  /*
   * Set while a refresh is in flight. Without it a slow server render could have
   * two refreshes overlapping - which is more load, on the one page already
   * struggling for CPU.
   */
  const refreshing = useRef(false);

  // What the banner should say: the server's answer once we have one, falling back
  // to what the page was rendered with.
  const isWorking = live?.working ?? working;
  const currentLabel = live?.label ?? label;

  const poll = useCallback(async () => {
    try {
      const res = await fetch(statusHref, { cache: 'no-store' });
      if (!res.ok) {
        /*
         * 401/403 means the session went while the tab sat open. Refreshing sends
         * them to the login screen, which is the truth; continuing to poll would
         * just count failures against a page that is no longer theirs.
         */
        if (res.status === 401 || res.status === 403) {
          router.refresh();
          return { stop: true };
        }
        failures.current += 1;
        return {};
      }
      const json = (await res.json()) as {
        ok?: boolean;
        working?: boolean;
        label?: string | null;
        fingerprint?: string;
      };
      if (!json?.ok || typeof json.fingerprint !== 'string') {
        failures.current += 1;
        return {};
      }
      failures.current = 0;
      setStalePoll(false);

      const changed =
        fingerprint.current !== null && fingerprint.current !== json.fingerprint;
      fingerprint.current = json.fingerprint;
      setLive({ working: Boolean(json.working), label: json.label ?? null });

      /*
       * THE ONLY PLACE THE PAGE IS RE-RENDERED. Something the screen shows has
       * actually changed - a scene narrated, the render finished, a job failed - so
       * it is worth the server render. Nothing else here costs one.
       */
      if (changed && !refreshing.current) {
        refreshing.current = true;
        router.refresh();
        // The refresh is not awaitable; release the latch on the next beat so a
        // genuinely stuck render cannot block every later update.
        window.setTimeout(() => {
          refreshing.current = false;
        }, WORK_POLL_INTERVAL_MS);
      }
      return { stop: json.working === false && changed };
    } catch {
      // Offline, a dropped connection, a blip while ffmpeg has the CPU. Try again.
      failures.current += 1;
      return {};
    }
  }, [statusHref, router]);

  useEffect(() => {
    if (!isWorking) {
      // Settled: forget any earlier wait so a later job starts its own clock.
      startedAt.current = null;
      failures.current = 0;
      setGaveUp(false);
      setStalePoll(false);
      return;
    }
    if (gaveUp) return;

    startedAt.current ??= Date.now();
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      if (cancelled) return;
      const elapsed = Date.now() - (startedAt.current ?? Date.now());
      if (elapsed > WORK_POLL_CEILING_MS) {
        setGaveUp(true);
        return;
      }
      const { stop } = await poll();
      if (cancelled || stop) return;
      // Several failures in a row is worth SAYING rather than hiding: the person is
      // watching a spinner and deserves to know we have lost contact.
      if (failures.current >= 3) setStalePoll(true);
      timer = window.setTimeout(tick, workPollDelayMs(elapsed));
    };

    timer = window.setTimeout(tick, workPollDelayMs(0));

    // Coming back to the tab should show the truth immediately rather than waiting
    // out the rest of an interval.
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isWorking, gaveUp, poll]);

  if (!isWorking) return null;

  return (
    <p
      // Announced, because the whole point is that something is happening that the
      // person cannot see.
      role="status"
      aria-live="polite"
      className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-50 px-4 py-3 text-sm text-ink"
    >
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
      <span className="font-semibold">{currentLabel ?? 'Working'}…</span>
      {gaveUp ? (
        <span className="text-ink-muted">
          This is taking longer than expected. It may still be running — check
          again, and the version’s history will show if it failed.
        </span>
      ) : stalePoll ? (
        <span className="text-ink-muted">
          Still working, but we have lost contact with the server for a moment. This
          will catch up on its own — nothing has been lost.
        </span>
      ) : (
        <span className="text-ink-muted">
          This page updates on its own as each step finishes. You do not need to
          reload it.
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setGaveUp(false);
          failures.current = 0;
          startedAt.current = Date.now();
          void poll();
          router.refresh();
        }}
        className="ml-auto font-semibold text-brand-700 hover:underline"
      >
        Check now
      </button>
    </p>
  );
}
