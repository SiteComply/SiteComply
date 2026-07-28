import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  saveSiteInformation,
  type SiteInformationInput,
} from '@/services/sites/siteInformationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/site-information
 * Save the structured Site Information text fields (SC-008). Gated on the `sites`
 * edit permission + site scope (site managers included). The site-map image is
 * handled separately by the sibling /site-map route (multipart).
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

  let body: SiteInformationInput;
  try {
    body = (await req.json()) as SiteInformationInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveSiteInformation(viewer, params.id, body);
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      { ok: false, error: 'Could not save site information.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
