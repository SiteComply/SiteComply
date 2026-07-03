import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateAuditMeta,
  updateAudit,
  type AuditMetaInput,
} from '@/services/audits/auditService';

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
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
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
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = validateAuditMeta(body, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const updated = await updateAudit(viewer, params.id, result.value);
  if ('notFound' in updated) {
    return NextResponse.json({ ok: false, error: 'Audit not found.' }, { status: 404 });
  }
  if (!updated.ok) {
    return NextResponse.json({ ok: false, errors: updated.errors }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: updated.id });
}
