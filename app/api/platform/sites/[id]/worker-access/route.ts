import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canManageWorkerAccess,
  inviteWorker,
  approveAssignment,
  suspendAssignment,
  reinstateAssignment,
  removeAssignment,
  setAssignmentDetails,
  transferWorker,
  setWorkerPanel,
  setSiteRequirement,
} from '@/services/workerAccess/workerAssignmentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/worker-access
 *   { action: 'invite', mobile, fullName, company }
 *   { action: 'approve' | 'suspend' | 'reinstate' | 'remove', assignmentId }
 *   { action: 'setDetails', assignmentId, startDate?, endDate? }
 *   { action: 'transfer', assignmentId, toSiteId }
 *   { action: 'setPanel', workerId, panel, enabled }
 *   { action: 'setRequirement', requirement, enabled, confirm? }
 *       → 409 with the preview until `confirm: true` is sent
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
    case 'setDetails':
      // SC-023 Phase 2 — the access window. `role` is no longer accepted: it was
      // recorded and never read, so taking it would let a caller believe they had
      // set something meaningful.
      result = await setAssignmentDetails(viewer, params.id, assignmentId, {
        startDate: typeof body.startDate === 'string' ? body.startDate : null,
        endDate: typeof body.endDate === 'string' ? body.endDate : null,
      });
      break;
    case 'transfer':
      if (typeof body.toSiteId !== 'string' || !body.toSiteId) {
        return NextResponse.json(
          { ok: false, error: 'Choose a project to transfer to.' },
          { status: 400 },
        );
      }
      result = await transferWorker(
        viewer,
        params.id,
        assignmentId,
        body.toSiteId,
      );
      break;
    case 'setRequirement': {
      // The mandatory preview is enforced in the SERVICE, so calling this API
      // directly cannot skip it: without `confirm` it returns who would be
      // blocked and writes nothing.
      if (
        typeof body.requirement !== 'string' ||
        typeof body.enabled !== 'boolean'
      ) {
        return NextResponse.json(
          { ok: false, error: 'Invalid request.' },
          { status: 400 },
        );
      }
      const r = await setSiteRequirement(
        viewer,
        params.id,
        body.requirement as never,
        body.enabled,
        body.confirm === true,
      );
      if (r.ok) {
        return NextResponse.json({
          ok: true,
          blockedAtEnable: r.blockedAtEnable,
        });
      }
      if (r.reason === 'preview_required') {
        // 409, not 400: the request is well formed, it just has not been
        // confirmed against its consequences yet.
        return NextResponse.json(
          { ok: false, previewRequired: true, preview: r.preview },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { ok: false, error: r.error ?? 'Could not update the requirement.' },
        {
          status:
            r.reason === 'forbidden'
              ? 403
              : r.reason === 'not_found'
                ? 404
                : 400,
        },
      );
    }
    case 'setPanel':
      if (
        typeof body.workerId !== 'string' ||
        typeof body.panel !== 'string' ||
        typeof body.enabled !== 'boolean'
      ) {
        return NextResponse.json(
          { ok: false, error: 'Invalid request.' },
          { status: 400 },
        );
      }
      result = await setWorkerPanel(
        viewer,
        params.id,
        body.workerId,
        body.panel,
        body.enabled,
      );
      break;
    default:
      return NextResponse.json(
        { ok: false, error: 'Unknown action.' },
        { status: 400 },
      );
  }

  if (result.ok) {
    // `existingWorker` is present only when the mobile was already known, and
    // carries the details that will actually be used — the invite deliberately
    // does not overwrite a record that may hold verified competency.
    // `autoApproved` says whether access was granted outright, or still needs a
    // manager to approve it (a previously suspended or removed worker does).
    return NextResponse.json({
      ok: true,
      smsDelivered: result.smsDelivered,
      existingWorker: result.existingWorker ?? null,
      autoApproved: result.autoApproved ?? false,
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
