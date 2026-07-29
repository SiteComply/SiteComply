import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateAuditMeta,
  createAudit,
  type AuditMetaInput,
} from '@/services/audits/auditService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audits
 * Create an audit. Enforces the audits "create" permission and the
 * Assigned-Sites boundary (the chosen site + any referenced documents must be
 * in scope). Body: { title, description, observations, overallScore,
 * jobSiteId, documentIds[] }.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'audits', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to create audits.' },
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

  const created = await createAudit(viewer, result.value);
  if (!created.ok) {
    return NextResponse.json(
      { ok: false, errors: created.errors },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, id: created.id });
}
