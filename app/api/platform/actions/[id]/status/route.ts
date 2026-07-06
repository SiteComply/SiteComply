import { NextRequest, NextResponse } from 'next/server';
import { ActionStatus } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { setActionStatus } from '@/services/actions/actionService';
import { isActionStatus } from '@/services/actions/actionConstants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/actions/[id]/status
 * Body: { status: "OPEN" | "IN_PROGRESS" | "COMPLETED" }
 * Move an action through its status workflow. Enforces the actions "edit"
 * permission and the Assigned-Sites boundary. Completing sets completedAt.
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
      { ok: false, error: 'You do not have permission to update actions.' },
      { status: 403 },
    );
  }

  let body: { status?: string; note?: string };
  try {
    body = (await req.json()) as { status?: string; note?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (!body.status || !isActionStatus(body.status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }

  const updated = await setActionStatus(
    viewer,
    params.id,
    body.status as ActionStatus,
    body.note,
  );
  if (!updated.ok) {
    if (updated.reason === 'note_required') {
      return NextResponse.json(
        { ok: false, error: 'A completion note is required to mark this action Completed.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
