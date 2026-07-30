import { NextRequest, NextResponse } from 'next/server';
import { SchedulerTrigger } from '@prisma/client';
import { runScheduledGeneration } from '@/services/compliance/schedulerRunner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 4 — POST /api/system/compliance/tick
 *
 * The scheduled trigger's entry point, called hourly by an Azure Logic App
 * recurrence. Guarded by a SHARED SECRET rather than a platform session, because
 * there is no user involved.
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

/** Timing-safe string comparison over the raw bytes. */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    // Disabled, not open.
    return NextResponse.json(
      { ok: false, error: 'Scheduler is not configured.' },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get('x-scheduler-secret') ??
    req.nextUrl.searchParams.get('secret') ??
    '';
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const manual = req.nextUrl.searchParams.get('manual') === 'true';
  const result = await runScheduledGeneration(
    manual ? SchedulerTrigger.MANUAL : SchedulerTrigger.TIMER,
  );

  // 200 even on a recorded failure: the Logic App should not retry-storm, and the
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
