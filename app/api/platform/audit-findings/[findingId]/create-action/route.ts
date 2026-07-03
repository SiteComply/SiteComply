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
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { findingId: string } },
) {
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

  const created = await createActionFromFinding(viewer, params.findingId);
  if (!created) {
    return NextResponse.json({ ok: false, error: 'Finding not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: created.id });
}
