import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  previewConfigTemplate,
  applyConfigTemplate,
} from '@/services/siteServices/siteConfigTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites/[id]/apply-config-template
 *   { templateId, confirm: false }  → PREVIEW, writes nothing
 *   { templateId, confirm: true }   → apply
 *
 * SC-021 Phase 2. Two-step by design: REPLACE semantics are only safe to offer
 * if the manager can see every change and every refusal first. Preview and apply
 * run the same resolution, so what is confirmed is what happens.
 */
export async function POST(
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
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot configure this site.' },
      { status: 403 },
    );
  }

  let body: { templateId?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (typeof body.templateId !== 'string' || !body.templateId) {
    return NextResponse.json(
      { ok: false, error: 'Choose a template.' },
      { status: 400 },
    );
  }

  if (body.confirm === true) {
    const r = await applyConfigTemplate(viewer, params.id, body.templateId);
    if (r.ok) return NextResponse.json({ ok: true, applied: r.applied });
    return NextResponse.json(
      { ok: false, error: r.error ?? 'Could not apply the template.' },
      {
        status:
          r.reason === 'forbidden' ? 403 : r.reason === 'not_found' ? 404 : 400,
      },
    );
  }

  const r = await previewConfigTemplate(viewer, params.id, body.templateId);
  if (r.ok) return NextResponse.json({ ok: true, preview: r.preview });
  return NextResponse.json(
    { ok: false, error: 'Could not preview the template.' },
    { status: r.reason === 'forbidden' ? 403 : 404 },
  );
}
