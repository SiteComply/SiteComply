import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  saveSiteEmergency,
  type SiteEmergencyInput,
} from '@/services/sites/siteInformationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/emergency
 *
 * Save the emergency information workers see: fire assembly point, first aider
 * (name, number, location), nearest A&E and site emergency number.
 *
 * Gated on the `sites` edit permission + site scope — the SAME gate as the
 * sibling /site-information route, and therefore the same roles the RBAC matrix
 * puts in charge of running a site. These fields previously reached the database
 * only via PATCH /api/platform/sites/[id], which is Director-only, so a Site
 * Manager could see the information was missing and had no way to add it.
 *
 * This route accepts ONLY the six emergency fields. Site name, address, job
 * reference, status, archive and reactivate remain on the Director-only route
 * behind SITE_EDIT_ROLES, which is unchanged.
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

  let body: SiteEmergencyInput;
  try {
    body = (await req.json()) as SiteEmergencyInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveSiteEmergency(viewer, params.id, body);
  if (!result.ok) {
    // Out of scope is reported as forbidden rather than 404: the service treats
    // both the same, and confirming a site exists outside the viewer's scope
    // would leak its existence.
    return NextResponse.json(
      { ok: false, error: 'You cannot configure this site.' },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true });
}
