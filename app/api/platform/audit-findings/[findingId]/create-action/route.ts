import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { createActionFromFinding } from '@/services/actions/actionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audit-findings/[findingId]/create-action
 * Generate a corrective action from an audit finding (findings → actions).
 * Enforces the actions "create" permission and the Assigned-Sites boundary (the
 * finding's audit must be in scope). Returns the new action id.
 *
 * SC-015: the body must name a responsible person — findings→actions creates
 * actions like any other path and is held to the same mandatory-assignee rule,
 * rather than being a back door for unassigned actions.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { findingId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'actions', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to create actions.' },
      { status: 403 },
    );
  }

  let body: { assigneeKind?: string; assigneeId?: string };
  try {
    body = (await req.json()) as { assigneeKind?: string; assigneeId?: string };
  } catch {
    body = {};
  }

  const kind = body.assigneeKind;
  const assigneeId = (body.assigneeId ?? '').trim();
  if (!assigneeId || (kind !== 'WORKER' && kind !== 'PLATFORM_USER')) {
    return NextResponse.json(
      { ok: false, error: 'Please choose who is responsible for this action.' },
      { status: 400 },
    );
  }

  const created = await createActionFromFinding(viewer, params.findingId, {
    kind,
    id: assigneeId,
  });
  if (!created.ok) {
    if (created.reason === 'invalid_assignee') {
      return NextResponse.json(
        {
          ok: false,
          error: 'That person cannot be assigned actions on this site.',
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Finding not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: created.id });
}
