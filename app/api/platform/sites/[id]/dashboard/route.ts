import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { updatePanelVisibility } from '@/services/workerDashboard/dashboardConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/dashboard
 * Body: { panels: { [WorkerDashboardPanel]: boolean } }
 *
 * Sets which panels this site's Worker Dashboard displays (SC-003). Gated on the
 * `sites` "edit" permission — the capability site managers hold for their own
 * sites — plus the Assigned-Sites boundary, both re-checked in the service.
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
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot configure this site.' },
      { status: 403 },
    );
  }

  let body: { panels?: Record<string, unknown> };
  try {
    body = (await req.json()) as { panels?: Record<string, unknown> };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body?.panels || typeof body.panels !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'No panel settings supplied.' },
      { status: 400 },
    );
  }

  const result = await updatePanelVisibility(viewer, params.id, body.panels);
  if (!result.ok) {
    if (result.reason === 'forbidden') {
      return NextResponse.json(
        { ok: false, error: 'You cannot configure this site.' },
        { status: 403 },
      );
    }
    if (result.reason === 'invalid') {
      return NextResponse.json(
        { ok: false, error: 'Unrecognised panel settings.' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'That site was not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, visibility: result.visibility });
}
