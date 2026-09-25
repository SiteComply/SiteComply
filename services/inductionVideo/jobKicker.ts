/**
 * Starting queued induction work NOW, instead of at five past the hour.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * The platform has one background mechanism: the Azure timer that calls the
 * compliance tick hourly. That was fine when a script was the only thing queued
 * - a manager pressed Generate and read the result later. Chained, it is not: a
 * script, then narration, then a render, each waiting for the next tick, is up
 * to THREE HOURS before a manager sees a video. Nobody would use that twice.
 *
 * ── WHY A NUDGE AND NOT A SECOND WORKER ───────────────────────────────────
 *
 * The queue, the claim and the error handling stay exactly where they are. This
 * only asks the SAME drain functions to run now, in this process, after the
 * request has been answered. The hourly tick remains the safety net: if the
 * process is recycled mid-run the job is still QUEUED (or RUNNING and visibly
 * stalled), and the tick picks it up as it always did.
 *
 * ── WHAT MAKES IT SAFE ────────────────────────────────────────────────────
 *
 *  - NOT AWAITED by the caller. A manager's button returns immediately; the
 *    speech service does not sit inside their HTTP request.
 *  - ONE DRAIN AT A TIME per process (`running`). Three managers pressing
 *    Generate together produce one drain, not three; each job is claimed by the
 *    database anyway, so the worst case was already correctness-safe - this just
 *    stops it being wasteful.
 *  - NEVER THROWS. A rejected promise with no handler would take the process
 *    down on Node 20. Everything is swallowed here and recorded on the job row
 *    by the drain functions themselves.
 *  - App Service only. This relies on a long-lived Node process, which is what
 *    the platform runs on; it would be wrong on a serverless host, where the
 *    response ends the execution context.
 */

import { runQueuedScriptJobs } from '@/services/inductionVideo/inductionVideoService';
import { runQueuedNarrationJobs } from '@/services/inductionVideo/narrationService';
import { runQueuedRenderJobs } from '@/services/inductionVideo/renderService';
import { runQueuedNormaliseJobs } from '@/services/inductionVideo/libraryAssetService';

let running = false;

/**
 * Drain the induction queues in the background. Fire and forget: callers do not
 * await it, and it resolves to whether a drain was started rather than to what
 * the drain found.
 */
export function kickInductionJobs(): boolean {
  if (running) return false;
  running = true;

  // A small delay so the queueing transaction is certainly visible to the drain's
  // own connection before it looks for work.
  setTimeout(() => {
    void (async () => {
      try {
        /*
         * NORMALISE FIRST, and it was missing from this list entirely until
         * 2026-09-25. An uploaded library video sat QUEUED until the hourly tick,
         * so the operator watched "Preparing the video…" for up to an hour with no
         * way to tell that from a failure - the exact wait this whole module was
         * built to remove, on the one job that is slowest to run.
         *
         * First, because nothing downstream can be issued until footage is
         * prepared, and one at a time because a transcode is the heaviest thing
         * this instance does.
         */
        try {
          await runQueuedNormaliseJobs(1);
        } catch {
          // Recorded against the job row; the next tick will try again.
        }
        try {
          await runQueuedScriptJobs();
        } catch {
          // Recorded against the job row; the next tick will try again.
        }
        try {
          await runQueuedNarrationJobs();
        } catch {
          // As above.
        }
        try {
          await runQueuedRenderJobs();
        } catch {
          // As above.
        }
      } finally {
        // In a finally, so an unexpected throw cannot leave this process unable
        // to nudge anything again for the rest of its life. A drain that HANGS
        // still blocks further nudges - the hourly tick is the answer to that,
        // and a stuck RUNNING job is visible on the version page.
        running = false;
      }
    })();
  }, 250);

  return true;
}

/** For tests: is a drain in flight in this process? */
export function drainInFlight(): boolean {
  return running;
}
