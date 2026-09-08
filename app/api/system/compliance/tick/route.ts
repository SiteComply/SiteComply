import { NextRequest, NextResponse } from 'next/server';
import { SchedulerTrigger } from '@prisma/client';
import { runScheduledGeneration } from '@/services/compliance/schedulerRunner';
import { authoriseScheduler } from '@/lib/schedulerAuth';

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

export async function POST(req: NextRequest) {
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

  // 200 even on a recorded failure: the timer should not retry-storm, and the
  // failure is already visible on the calendar's status line and in SchedulerRun.
  return NextResponse.json({
    ok: result.ok,
    runId: result.runId,
    sitesConsidered: result.sitesConsidered,
    occurrencesCreated: result.occurrencesCreated,
    escalationsRecorded: result.escalationsRecorded,
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {}),
  });
}
