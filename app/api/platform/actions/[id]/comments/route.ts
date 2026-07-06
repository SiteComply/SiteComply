import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { addActionComment } from '@/services/actions/actionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/actions/[id]/comments
 * Body: { body: string }
 * Add an update/comment to an action's activity timeline. Enforces the actions
 * "edit" permission and the Assigned-Sites boundary.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to comment on actions.' },
      { status: 403 },
    );
  }

  let body: { body?: string };
  try {
    body = (await req.json()) as { body?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await addActionComment(viewer, params.id, body.body ?? '');
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
    }
    return NextResponse.json(
      {
        ok: false,
        error:
          result.reason === 'empty'
            ? 'Please enter an update.'
            : 'Please keep the update shorter.',
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
