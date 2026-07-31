import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canManageContractorAccess,
  setModuleAccess,
  applyContractorPreset,
  resetAccess,
  revokeSiteAccess,
} from '@/services/platformUsers/contractorAccessService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/access
 *   { action: 'setModule', userId, module, verbs }  → narrow one module
 *   { action: 'applyPreset', userId }               → Contractor (standard)
 *   { action: 'reset', userId }                     → back to the role baseline
 *   { action: 'revoke', userId }                    → remove from the site
 *
 * SC-022 Phase 1. Gated on the contractor-access capability plus site scope,
 * both re-checked in the service. An out-of-scope site returns 404 rather than
 * 403 so the response never confirms a site exists.
 *
 * A refusal to narrow a Director, or to change your own access, comes back as
 * 403 WITH its reason — those are deliberate rules a user should understand,
 * not failures to debug.
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
  if (!canManageContractorAccess(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage access for this site.' },
      { status: 403 },
    );
  }

  let body: {
    action?: unknown;
    userId?: unknown;
    module?: unknown;
    verbs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (typeof body.userId !== 'string' || !body.userId) {
    return NextResponse.json(
      { ok: false, error: 'Missing user.' },
      { status: 400 },
    );
  }

  let result;
  switch (body.action) {
    case 'setModule':
      if (typeof body.module !== 'string' || !Array.isArray(body.verbs)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid request.' },
          { status: 400 },
        );
      }
      result = await setModuleAccess(
        viewer,
        params.id,
        body.userId,
        body.module,
        body.verbs.filter((v): v is string => typeof v === 'string'),
      );
      break;
    case 'applyPreset':
      result = await applyContractorPreset(viewer, params.id, body.userId);
      break;
    case 'reset':
      result = await resetAccess(viewer, params.id, body.userId);
      break;
    case 'revoke':
      result = await revokeSiteAccess(viewer, params.id, body.userId);
      break;
    default:
      return NextResponse.json(
        { ok: false, error: 'Unknown action.' },
        { status: 400 },
      );
  }

  if (result.ok) return NextResponse.json({ ok: true });
  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : 400;
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not update access.' },
    { status },
  );
}
