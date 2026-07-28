import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import {
  getSiteGps,
  evaluateFix,
  findValidOverride,
  parseLocationFix,
} from '@/services/geo/geoValidationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/location-check
 * Body: { siteId, location: { lat, lng, accuracyM } | { gpsUnavailable: true } }
 *
 * Classifies the worker's fix against the site's GPS config so the Location Check
 * step can show verified / outside / poor-accuracy / unavailable BEFORE they
 * commit. Advisory only — the check-in itself is re-validated server-side. Also
 * reports whether the site requires GPS and whether the worker has a manager
 * override (so the UI can offer to proceed).
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
      { ok: false, error: 'Worker not found.' },
      { status: 401 },
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

  const gps = await getSiteGps(body.siteId);
  if (!gps.enabled) {
    return NextResponse.json({ ok: true, required: false });
  }

  const fix = parseLocationFix(body.location) ?? { unavailable: true };
  const evaluation = evaluateFix(gps, fix);
  const override = await findValidOverride(worker.id, body.siteId);

  return NextResponse.json({
    ok: true,
    required: true,
    state: evaluation.state,
    distanceM: evaluation.distanceM,
    accuracyM: evaluation.accuracyM,
    radiusM: evaluation.radiusM,
    // The worker can proceed when verified, when a manager override exists, or
    // when GPS is unavailable and the site policy allows a flagged check-in.
    hasOverride: Boolean(override),
    allowUnavailable:
      evaluation.state === 'unavailable' &&
      gps.unavailablePolicy === 'ALLOW_FLAGGED',
  });
}
