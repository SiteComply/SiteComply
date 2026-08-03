import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canEditSite } from '@/services/platformUsers/platformPermissions';
import { setSiteStatusForDirector } from '@/services/sites/platformSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites/[id]/status
 * Body: { status: "ACTIVE" | "ARCHIVED" }
 *
 * Archive or reactivate a site from the Platform portal. Director-only and
 * site-scoped (a site outside the viewer's scope is treated as not found).
 * Only the status changes; all site history is preserved.
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
  if (!canEditSite(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Only Directors can archive or reactivate sites.' },
      { status: 403 },
    );
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await setSiteStatusForDirector(
    viewer,
    params.id,
    body.status ?? '',
  );
  if (!result.ok) {
    if (result.reason === 'invalid_status') {
      return NextResponse.json(
        { ok: false, error: 'Invalid status.' },
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
        { ok: false, error: 'Only Directors can archive or reactivate sites.' },
        { status: 403 },
      );
    }
    // not_found — out of scope or removed.
    return NextResponse.json(
      { ok: false, error: 'That site was not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, status: result.status });
}
