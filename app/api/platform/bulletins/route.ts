import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateBulletin,
  createBulletin,
  type BulletinInput,
} from '@/services/bulletins/bulletinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/bulletins
 * Publish a Daily Bulletin (SC-002). Enforces the bulletins "create" permission
 * and the Assigned-Sites boundary (the chosen site must be in scope).
 * Body: { jobSiteId, category, title?, body }.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'bulletins', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to publish bulletins.' },
      { status: 403 },
    );
  }

  let body: BulletinInput;
  try {
    body = (await req.json()) as BulletinInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = validateBulletin(body, viewer);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const created = await createBulletin(viewer, result.value);
  return NextResponse.json({ ok: true, id: created.id });
}
