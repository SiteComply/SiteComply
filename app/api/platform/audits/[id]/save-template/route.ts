import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { saveAuditAsTemplate } from '@/services/audits/auditTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audits/[id]/save-template (SC-013)
 * Save an existing audit as a reusable organisation-level template. Requires the
 * audits "create" permission; the audit must be in the viewer's scope.
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
  if (!permits(viewer.role, 'audits', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to save templates.' },
      { status: 403 },
    );
  }

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveAuditAsTemplate(viewer, params.id, body.name ?? '');
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not save the template.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}
