import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  createTemplate,
  type TemplateInput,
} from '@/services/audits/auditTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audit-templates (SC-013) — create a new audit template.
 * Any audit-creating role may add to the shared library.
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
      { ok: false, error: 'You do not have permission to create templates.' },
      { status: 403 },
    );
  }
  let body: TemplateInput;
  try {
    body = (await req.json()) as TemplateInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  const result = await createTemplate(viewer, body);
  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not create the template.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}
