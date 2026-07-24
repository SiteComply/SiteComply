import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  createSiteContact,
  type SiteContactInput,
} from '@/services/sites/siteContactService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites/[id]/contacts
 * Add a site contact shown on the Worker Dashboard (SC-003). Requires the
 * `sites` "edit" permission and the site to be in the viewer's scope.
 */
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
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage this site’s contacts.' },
      { status: 403 },
    );
  }

  let body: SiteContactInput;
  try {
    body = (await req.json()) as SiteContactInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await createSiteContact(viewer, params.id, body ?? {});
  if (!result.ok) {
    if (result.reason === 'validation') {
      return NextResponse.json(
        { ok: false, errors: result.errors },
        { status: 400 },
      );
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json(
        { ok: false, error: 'You cannot manage this site’s contacts.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'That site was not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
