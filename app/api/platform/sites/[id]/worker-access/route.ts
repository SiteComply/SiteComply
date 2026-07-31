import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canManageWorkerAccess,
  inviteWorker,
  approveAssignment,
  suspendAssignment,
  reinstateAssignment,
  removeAssignment,
  setSiteEnforcement,
} from '@/services/workerAccess/workerAssignmentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/worker-access
 *   { action: 'invite', mobile, fullName, company }
 *   { action: 'approve' | 'suspend' | 'reinstate' | 'remove', assignmentId }
 *   { action: 'setEnforcement', enabled }        → DIRECTOR ONLY
 *
 * SC-023 Phase 1. Gated on the worker-access capability plus site scope, both
 * re-checked in the service. An out-of-scope site returns 404, not 403, so the
 * response never confirms a site exists.
 *
 * Enforcement changes return 409 when blocked: refusing to switch it on while
 * workers would be locked out is a conflict with live state, not bad input.
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
  if (!canManageWorkerAccess(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage worker access for this site.' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const assignmentId =
    typeof body.assignmentId === 'string' ? body.assignmentId : '';

  if (body.action === 'setEnforcement') {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: 'Invalid request.' },
        { status: 400 },
      );
    }
    const r = await setSiteEnforcement(viewer, params.id, body.enabled);
    if (r.ok) return NextResponse.json({ ok: true });
    const status =
      r.reason === 'forbidden' ? 403 : r.reason === 'not_found' ? 404 : 409;
    return NextResponse.json(
      { ok: false, error: r.error ?? 'Could not change enforcement.' },
      { status },
    );
  }

  let result;
  switch (body.action) {
    case 'invite':
      result = await inviteWorker(viewer, params.id, {
        mobile: String(body.mobile ?? ''),
        fullName: String(body.fullName ?? ''),
        company: String(body.company ?? ''),
      });
      break;
    case 'approve':
      result = await approveAssignment(viewer, params.id, assignmentId);
      break;
    case 'suspend':
      result = await suspendAssignment(viewer, params.id, assignmentId);
      break;
    case 'reinstate':
      result = await reinstateAssignment(viewer, params.id, assignmentId);
      break;
    case 'remove':
      result = await removeAssignment(viewer, params.id, assignmentId);
      break;
    default:
      return NextResponse.json(
        { ok: false, error: 'Unknown action.' },
        { status: 400 },
      );
  }

  if (result.ok) {
    // The invitation code comes back so a manager can read it out immediately.
    // With SMS on the mock provider this is the ONLY working route, and on a
    // real site with poor signal it is often the faster one.
    return NextResponse.json({
      ok: true,
      invitationCode: result.invitationCode,
      smsDelivered: result.smsDelivered,
    });
  }
  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : 400;
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not update worker access.' },
    { status },
  );
}
