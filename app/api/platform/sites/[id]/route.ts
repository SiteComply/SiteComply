import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canEditSite } from '@/services/platformUsers/platformPermissions';
import {
  updateSiteForDirector,
  type PlatformSiteInput,
} from '@/services/sites/platformSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]
 * Update a job site (details, address and status — including archive/reactivate)
 * from the Platform portal. Director-only, and enforces site-scoping: a site
 * outside the viewer's scope is treated as not found.
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
  if (!canEditSite(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Only Directors can edit sites.' },
      { status: 403 },
    );
  }

  let body: PlatformSiteInput;
  try {
    body = (await req.json()) as PlatformSiteInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await updateSiteForDirector(viewer, params.id, body ?? {});
  if (!result.ok) {
    if (result.reason === 'validation') {
      return NextResponse.json(
        { ok: false, errors: result.errors },
        { status: 400 },
      );
    }
    if (result.reason === 'project_completed') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This project has been completed and its records are read-only. A Director can reopen it if changes are needed.',
        },
        { status: 409 },
      );
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json(
        { ok: false, error: 'Only Directors can edit sites.' },
        { status: 403 },
      );
    }
    // not_found — out of scope or removed.
    return NextResponse.json(
      { ok: false, error: 'That site was not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
