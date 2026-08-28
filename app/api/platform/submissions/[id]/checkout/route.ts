import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  overrideCheckOut,
  type OverrideCheckOutFailure,
} from '@/services/submissions/submissionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/submissions/[id]/checkout
 * Body: { reason: string }
 *
 * BL-001 — an authorised manual check-out. Closes a check-in the worker never
 * closed, and annotates it permanently with who did it, in what role, and why.
 *
 * Status contract, so the client can say something true about each outcome:
 *   401 not signed in · 403 role not permitted · 400 reason missing
 *   404 not in the viewer's sites · 409 already checked out · 200 done
 *
 * Authorisation and site scope are decided inside the service, in the same
 * statement that performs the write — not here — so this route cannot drift
 * from the rule it is supposed to enforce.
 */
const STATUS: Record<OverrideCheckOutFailure, number> = {
  forbidden: 403,
  reason_required: 400,
  not_found: 404,
  already_out: 409,
};

const MESSAGE: Record<OverrideCheckOutFailure, string> = {
  forbidden: 'Your role cannot check a worker out.',
  reason_required: 'A reason is required.',
  not_found: 'That check-in is not available on your sites.',
  already_out: 'That worker has already been checked out.',
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await overrideCheckOut(viewer, params.id, body.reason ?? '');
  if (!result.ok && result.reason) {
    return NextResponse.json(
      { ok: false, error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  }
  return NextResponse.json({ ok: true });
}
