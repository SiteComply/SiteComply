import { runQueuedScriptJobs } from '@/services/inductionVideo/inductionVideoService';
import { runQueuedNarrationJobs } from '@/services/inductionVideo/narrationService';
import { runQueuedRenderJobs } from '@/services/inductionVideo/renderService';
import { runQueuedNormaliseJobs } from '@/services/inductionVideo/libraryAssetService';
import { sweepUnpublishedRenders } from '@/services/inductionVideo/retentionService';
import { NextRequest, NextResponse } from 'next/server';
import { SchedulerTrigger } from '@prisma/client';
import { runScheduledGeneration } from '@/services/compliance/schedulerRunner';
import { authoriseScheduler } from '@/lib/schedulerAuth';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 4 — POST /api/system/compliance/tick
 *
 * The scheduled trigger's entry point, called hourly by the Azure Functions
 * timer in azure/scheduler-function (a Logic App recurrence was preferred but
 * Microsoft.Logic is unregistered on this subscription and cannot be registered
 * with the access available — see that directory's README). Guarded by a SHARED
 * SECRET rather than a platform session, because there is no user involved.
 *
 * Security properties, deliberately:
 *  - The secret is compared in CONSTANT TIME, so the endpoint cannot be used as
 *    an oracle to discover it byte by byte.
 *  - If SCHEDULER_SECRET is unset the endpoint is DISABLED rather than open. A
 *    misconfigured deploy must not expose an unauthenticated write path.
 *  - The response contains only counts — never site, worker or personal data — so
 *    even a leaked secret discloses nothing about the sites themselves.
 *  - Unauthorised calls return 401 without saying why, and are not logged as
 *    scheduler runs, so probing cannot pollute the health signal the calendar
 *    shows.
 */

async function POSTHandler(req: NextRequest) {
  const auth = authoriseScheduler(req);
  if (auth === 'disabled') {
    return NextResponse.json(
      { ok: false, error: 'Scheduler is not configured.' },
      { status: 503 },
    );
  }
  if (auth !== 'ok') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const manual = req.nextUrl.searchParams.get('manual') === 'true';
  const result = await runScheduledGeneration(
    manual ? SchedulerTrigger.MANUAL : SchedulerTrigger.TIMER,
  );

  /*
   * INDUCTION VIDEO JOBS ride the same tick.
   *
   * The platform has one background mechanism - this endpoint, called by the
   * scheduler - so script generation drains its queue here rather than
   * introducing a second worker to operate, secure and monitor. It is deliberately
   * AFTER the compliance run and in its own try: a model outage must not stop
   * compliance occurrences being created.
   */
  let scriptsGenerated = 0;
  try {
    scriptsGenerated = await runQueuedScriptJobs();
  } catch {
    // Already recorded against the job row; the tick itself still succeeded.
  }

  /*
   * NARRATION RIDES THE SAME TICK, in its own try for the same reason. It is
   * drained AFTER the scripts so a newly generated script can be narrated on the
   * following hour rather than waiting on a queue behind one; and a speech
   * outage must leave both the compliance run and script generation alone.
   */
  let narrationsGenerated = 0;
  try {
    narrationsGenerated = await runQueuedNarrationJobs();
  } catch {
    // Already recorded against the job row; the tick itself still succeeded.
  }

  // Renders last: the longest job, and the one a failure of which must not
  // delay the cheap work behind it.
  let videosRendered = 0;
  let libraryPrepared = 0;
  try {
    videosRendered = await runQueuedRenderJobs();
  } catch {
    // Already recorded against the job row; the tick itself still succeeded.
  }
  /*
   * ITS OWN try, which is the whole point. This shared a try with the render
   * drain, so anything thrown OUTSIDE a render's own per-job handling - resolving
   * the renderer, the initial query - skipped the library queue for that hour. One
   * repeatedly-failing render could therefore starve library transcoding
   * indefinitely, and the tick would report success each time.
   *
   * Last and one at a time: transcoding is the heaviest thing on this instance, so
   * a script or a render somebody is waiting on comes first.
   */
  try {
    libraryPrepared = await runQueuedNormaliseJobs(1);
  } catch {
    // Already recorded against the job row; the tick itself still succeeded.
  }

  /*
   * Retention: removes the MP4s of superseded versions nobody published and
   * nobody watched. Does nothing at all unless INDUCTION_MEDIA_RETENTION_DAYS is
   * set - a policy about records is a decision, not a default.
   */
  let rendersRemoved = 0;
  try {
    rendersRemoved = (await sweepUnpublishedRenders()).removed;
  } catch {
    // Storage hiccup; the sweep is idempotent and runs again next hour.
  }

  // 200 even on a recorded failure: the timer should not retry-storm, and the
  // failure is already visible on the calendar's status line and in SchedulerRun.
  return NextResponse.json({
    ok: result.ok,
    scriptsGenerated,
    narrationsGenerated,
    videosRendered,
    libraryPrepared,
    rendersRemoved,
    runId: result.runId,
    sitesConsidered: result.sitesConsidered,
    occurrencesCreated: result.occurrencesCreated,
    escalationsRecorded: result.escalationsRecorded,
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {}),
  });
}

export const POST = withClosedProjectHandling(POSTHandler);
