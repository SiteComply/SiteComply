import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateAuditMeta,
  updateAudit,
  deleteAudit,
  type AuditMetaInput,
} from '@/services/audits/auditService';
import { canDeleteAudit } from '@/services/audits/auditConstants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/audits/[id]
 * Update an audit's details / site / referenced documents. Enforces the audits
 * "edit" permission and the Assigned-Sites boundary (existing + target site, and
 * every referenced document, must be in scope).
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
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to edit audits.' },
      { status: 403 },
    );
  }

  let body: AuditMetaInput;
  try {
    body = (await req.json()) as AuditMetaInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = validateAuditMeta(body, viewer);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const updated = await updateAudit(viewer, params.id, result.value);
  if ('notFound' in updated) {
    return NextResponse.json(
      { ok: false, error: 'Audit not found.' },
      { status: 404 },
    );
  }
  if (!updated.ok) {
    return NextResponse.json(
      { ok: false, errors: updated.errors },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, id: updated.id });
}

/**
 * DELETE /api/platform/audits/[id]
 * Permanently delete an audit and all its findings. Restricted to the audit
 * delete-role allow-list (Director, Project Manager, Auditor, H&S Consultant,
 * Principal Contractor) — a deliberate rule distinct from the "edit" permission
 * — plus the Assigned-Sites boundary. Referenced documents are left intact.
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
  if (!canDeleteAudit(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to delete audits.' },
      { status: 403 },
    );
  }

  const deleted = await deleteAudit(viewer, params.id);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: 'Audit not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
