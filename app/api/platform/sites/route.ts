import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canCreateSite } from '@/services/platformUsers/platformPermissions';
import {
  createSiteForDirector,
  type PlatformSiteInput,
} from '@/services/sites/platformSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites
 * Create a new job site from the Platform portal. Director-only; the service
 * seeds a default UK induction checklist so the site is immediately usable.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canCreateSite(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Only Directors can create sites.' },
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

  const result = await createSiteForDirector(viewer, body ?? {});
  if (!result.ok) {
    if (result.reason === 'validation') {
      return NextResponse.json(
        { ok: false, errors: result.errors },
        { status: 400 },
      );
    }
    if (result.reason === 'forbidden') {
      return NextResponse.json(
        { ok: false, error: 'Only Directors can create sites.' },
        { status: 403 },
      );
    }
    // no_admin: no attributor exists — a misconfiguration, not a user error.
    return NextResponse.json(
      {
        ok: false,
        error: 'Unable to create the site right now. Please try again later.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
