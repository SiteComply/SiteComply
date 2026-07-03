import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateFinding,
  updateFinding,
  type FindingInput,
} from '@/services/audits/findingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/audit-findings/[findingId]
 * Edit a finding (including its corrective action and status). Enforces the
 * audits "edit" permission and the Assigned-Sites boundary (the finding's audit
 * must be in the viewer's scope).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { findingId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to edit audit findings.' },
      { status: 403 },
    );
  }

  let body: FindingInput;
  try {
    body = (await req.json()) as FindingInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = validateFinding(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const updated = await updateFinding(viewer, params.findingId, result.value);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Finding not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id });
}
