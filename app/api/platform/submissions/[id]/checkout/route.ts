import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManualCheckOut } from '@/services/platformUsers/platformPermissions';
import {
  manualCheckOut,
  type ManualCheckOutReason,
} from '@/services/submissions/submissionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/submissions/[id]/checkout
 * Body: { reason: string }
 *
 * Manually check out a worker who is still on site. Restricted to the manual
 * check-out roles (Director / Project Manager); the service enforces the
 * Assigned-Sites boundary and that the check-in is still open. A reason is
 * mandatory and, with the actor and time, is recorded in the audit trail.
 */
const STATUS: Record<ManualCheckOutReason, number> = {
  no_reason: 400,
  not_found: 404,
  already_out: 409,
};
const MESSAGE: Record<ManualCheckOutReason, string> = {
  no_reason: 'A reason is required to check a worker out.',
  not_found: 'That check-in was not found in your sites.',
  already_out: 'This worker has already been checked out.',
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!canManualCheckOut(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Your role is not permitted to check workers out.' },
      { status: 403 },
    );
  }

  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await manualCheckOut(viewer, params.id, body.reason ?? '');
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  }

  return NextResponse.json({ ok: true });
}
