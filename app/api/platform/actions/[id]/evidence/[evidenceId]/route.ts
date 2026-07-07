import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { deleteActionEvidence } from '@/services/actions/actionEvidenceService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/platform/actions/[id]/evidence/[evidenceId]
 * Remove an evidence file (delete the blob + row). Enforces the actions "edit"
 * permission and the Assigned-Sites boundary.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; evidenceId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to remove evidence.' },
      { status: 403 },
    );
  }

  const result = await deleteActionEvidence(viewer, params.id, params.evidenceId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'Evidence not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
