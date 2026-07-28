import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  markUnderReview,
  approvePermit,
  rejectPermit,
  closePermit,
} from '@/services/permits/permitAdminService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/permits/[id] (SC-009)
 *   { action: 'review' }                             → mark Under review
 *   { action: 'approve', validFrom?, validUntil }    → approve (approver roles)
 *   { action: 'reject', reason }                      → reject (approver roles)
 *   { action: 'close' }                               → close out
 * Gated on the `permits` edit permission + site scope; approve/reject additionally
 * require the PERMIT_APPROVAL_ROLES allow-list (enforced in the service).
 */
export async function PATCH(
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
  if (!permits(viewer.role, 'permits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage permits.' },
      { status: 403 },
    );
  }

  let body: {
    action?: string;
    validFrom?: string | null;
    validUntil?: string | null;
    reason?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const map = (r: { ok: boolean; reason?: string; error?: string }) => {
    const status =
      r.reason === 'forbidden' ? 403 : r.reason === 'not_found' ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: r.error ?? 'Could not update the permit.' },
      { status },
    );
  };

  if (body.action === 'review') {
    const r = await markUnderReview(viewer, params.id);
    return r.ok ? NextResponse.json({ ok: true }) : map(r);
  }
  if (body.action === 'approve') {
    const r = await approvePermit(viewer, params.id, {
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
    });
    return r.ok ? NextResponse.json({ ok: true }) : map(r);
  }
  if (body.action === 'reject') {
    const r = await rejectPermit(viewer, params.id, body.reason ?? '');
    return r.ok ? NextResponse.json({ ok: true }) : map(r);
  }
  if (body.action === 'close') {
    const r = await closePermit(viewer, params.id);
    return r.ok ? NextResponse.json({ ok: true }) : map(r);
  }

  return NextResponse.json(
    { ok: false, error: 'Unknown action.' },
    { status: 400 },
  );
}
