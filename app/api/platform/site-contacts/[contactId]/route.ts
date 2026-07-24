import { NextRequest, NextResponse } from 'next/server';
import {
  getPlatformViewer,
  type PlatformViewer,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  updateSiteContact,
  deleteSiteContact,
  type SiteContactInput,
} from '@/services/sites/siteContactService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH / DELETE /api/platform/site-contacts/[contactId]
 *
 * Edit or remove a single site contact (SC-003). The contact's owning site must
 * be in the viewer's scope — enforced in the service, which resolves the contact
 * only through `jobSiteId: { in: viewer.siteIds }`, so an out-of-scope id is
 * indistinguishable from one that doesn't exist.
 */
async function requireEditor(): Promise<PlatformViewer | NextResponse> {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage site contacts.' },
      { status: 403 },
    );
  }
  return viewer;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { contactId: string } },
) {
  const viewer = await requireEditor();
  if (viewer instanceof NextResponse) return viewer;

  let body: SiteContactInput;
  try {
    body = (await req.json()) as SiteContactInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await updateSiteContact(viewer, params.contactId, body ?? {});
  if (!result.ok) {
    if (result.reason === 'validation') {
      return NextResponse.json(
        { ok: false, errors: result.errors },
        { status: 400 },
      );
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json(
        { ok: false, error: 'You cannot manage site contacts.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'That contact was not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { contactId: string } },
) {
  const viewer = await requireEditor();
  if (viewer instanceof NextResponse) return viewer;

  const removed = await deleteSiteContact(viewer, params.contactId);
  if (!removed) {
    return NextResponse.json(
      { ok: false, error: 'That contact was not found.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
