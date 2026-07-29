import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageAuditTemplates } from '@/services/platformUsers/platformPermissions';
import {
  updateTemplate,
  setTemplateActive,
  deleteTemplate,
  type TemplateInput,
} from '@/services/audits/auditTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/audit-templates/[id] (SC-013)
 *   body { name, description, items[] }  → edit the shared template (bumps version)
 *   body { active: boolean }             → activate / deactivate
 * DELETE → delete a non-system template.
 * All restricted to AUDIT_TEMPLATE_MANAGE_ROLES.
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
  if (!canManageAuditTemplates(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage shared templates.' },
      { status: 403 },
    );
  }
  let body: TemplateInput & { active?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result =
    typeof body.active === 'boolean'
      ? await setTemplateActive(viewer, params.id, body.active)
      : await updateTemplate(viewer, params.id, body);

  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not update the template.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}

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
  if (!canManageAuditTemplates(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot manage shared templates.' },
      { status: 403 },
    );
  }
  const result = await deleteTemplate(viewer, params.id);
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not delete the template.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
