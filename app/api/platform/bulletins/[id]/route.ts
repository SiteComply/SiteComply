import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  setBulletinActive,
  deleteBulletin,
} from '@/services/bulletins/bulletinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/bulletins/[id]
 * Archive/retract or re-activate a bulletin. Enforces the bulletins "edit"
 * permission and the Assigned-Sites boundary. Body: { active: boolean }.
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
  if (!permits(viewer.role, 'bulletins', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to edit bulletins.' },
      { status: 403 },
    );
  }

  let body: { active?: unknown };
  try {
    body = (await req.json()) as { active?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (typeof body.active !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'Missing active flag.' },
      { status: 400 },
    );
  }

  const updated = await setBulletinActive(viewer, params.id, body.active);
  if ('notFound' in updated) {
    return NextResponse.json(
      { ok: false, error: 'Bulletin not found.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/platform/bulletins/[id]
 * Permanently delete a bulletin (and its acknowledgements). Enforces the
 * bulletins "edit" permission and the Assigned-Sites boundary.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'bulletins', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to delete bulletins.' },
      { status: 403 },
    );
  }

  const deleted = await deleteBulletin(viewer, params.id);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: 'Bulletin not found.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
