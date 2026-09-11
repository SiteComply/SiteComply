import { NextRequest, NextResponse } from 'next/server';
import { authoriseScheduler } from '@/lib/schedulerAuth';
import { deliverPendingReports } from '@/services/reports/reportDelivery';
import { mailerEnabled } from '@/services/reports/reportMailer';
import { purgeOldErrors, RETENTION_DAYS } from '@/services/telemetry/errorLog';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issue reports (Phase 2) — POST /api/system/reports/deliver
 *
 * The hourly catch-up for anything the inline send missed: a restart mid-send, a
 * Graph outage, a throttle, or the backlog stored while mail was switched off.
 * Guarded by the same shared secret as the compliance tick — no user is
 * involved, so there is no session to check.
 *
 * Returns counts only. A report's contents, reporter and page never appear here,
 * so a leaked secret discloses nothing about what anyone has reported.
 */
async function POSTHandler(req: NextRequest) {
  const auth = authoriseScheduler(req);
  if (auth === 'disabled') {
    return NextResponse.json({ ok: false, error: 'Scheduler is not configured.' }, { status: 503 });
  }
  if (auth !== 'ok') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Error-log retention, folded into the hourly sweep that already exists: a
  // separate timer would mean a new Function, a new app setting and a deploy of
  // the scheduler app, for a delete that removes nothing 23 hours out of 24.
  // Placed BEFORE the mail branch so retention still runs when mail is off —
  // the two are unrelated, and tying them would quietly stop the purge.
  // purgeOldErrors never throws, so housekeeping cannot fail delivery.
  const purgedErrors = await purgeOldErrors(RETENTION_DAYS);

  // 200 with `mail: 'disabled'` rather than an error: before the app settings
  // are added this is the expected steady state, and an hourly failing timer
  // would train everyone to ignore it.
  if (!mailerEnabled()) {
    return NextResponse.json({
      ok: true,
      mail: 'disabled',
      considered: 0,
      sent: 0,
      purgedErrors,
    });
  }

  const result = await deliverPendingReports();
  return NextResponse.json({ ok: true, mail: 'enabled', purgedErrors, ...result });
}

export const POST = withClosedProjectHandling(POSTHandler);
