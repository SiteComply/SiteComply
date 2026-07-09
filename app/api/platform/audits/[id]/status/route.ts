import { NextRequest, NextResponse } from 'next/server';
import { AuditStatus } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits, canSignOffAudit } from '@/services/platformUsers/platformPermissions';
import { setAuditStatus } from '@/services/audits/auditService';
import { isAuditStatus } from '@/services/audits/auditConstants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audits/[id]/status
 * Body: { status: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "SIGNED_OFF" }
 * Track an audit's status / sign it off. Enforces the audits "edit" permission
 * and the Assigned-Sites boundary. Moving to SIGNED_OFF records the signatory.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to update audits.' },
      { status: 403 },
    );
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (!body.status || !isAuditStatus(body.status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }

  // Signing off is restricted to the sign-off allow-list, over and above the
  // audits "edit" permission — an edit-capable role (e.g. a Project Manager) can
  // move an audit through DRAFT/IN_PROGRESS/COMPLETED but cannot sign it off.
  if (body.status === AuditStatus.SIGNED_OFF && !canSignOffAudit(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Your role is not permitted to sign off audits.' },
      { status: 403 },
    );
  }

  const updated = await setAuditStatus(viewer, params.id, body.status as AuditStatus);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Audit not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
