import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession, setActiveWorkerSiteCookie } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { expressCheckIn } from '@/services/induction/inductionValidityService';
import { parseLocationFix } from '@/services/geo/geoValidationService';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/express-checkin
 * Body: { siteId: string }
 *
 * Records an attendance check-in by reusing the worker's still-valid induction
 * (SC-006) — no wizard, no new knowledge check. Validity is re-derived
 * server-side, so this cannot be used to skip a required induction.
 */
export async function POST(req: NextRequest) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Please complete your details first.' },
      { status: 400 },
    );
  }

  let body: { siteId?: string; location?: unknown };
  try {
    body = (await req.json()) as { siteId?: string; location?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.siteId) {
    return NextResponse.json(
      { ok: false, error: 'No site specified.' },
      { status: 400 },
    );
  }

  // Express check-in can be switched off organisation-wide (Settings →
  // Authentication & Access). Refused HERE, at the write, not only by hiding
  // the button: the endpoint is reachable directly and the setting is a
  // control, not a decoration. The worker is told what to do instead.
  const { expressCheckInEnabled, workerSessionTtlSeconds } =
    await getAuthRuntimeConfig();
  if (!expressCheckInEnabled) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Express check-in is turned off for your organisation. Please complete the full check-in.',
      },
      { status: 403 },
    );
  }

  const result = await expressCheckIn(
    worker.id,
    body.siteId,
    parseLocationFix(body.location),
  );
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  // Land on this site's dashboard (SC-004), consistent with a full check-in.
  setActiveWorkerSiteCookie(body.siteId, workerSessionTtlSeconds);
  return NextResponse.json(result);
}
