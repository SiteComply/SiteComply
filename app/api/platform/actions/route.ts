import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateAction,
  createAction,
  type ActionInput,
} from '@/services/actions/actionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/actions
 * Create an action. Enforces the actions "create" permission and the
 * Assigned-Sites boundary (the chosen site must be in scope).
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to create actions.' },
      { status: 403 },
    );
  }

  let body: ActionInput;
  try {
    body = (await req.json()) as ActionInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = validateAction(body, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const created = await createAction(viewer, result.value);
  return NextResponse.json({ ok: true, id: created.id });
}
