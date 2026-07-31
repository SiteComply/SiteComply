import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';
import { createPermissionTemplate } from '@/services/platformUsers/permissionTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/permission-templates — create a shared permission template.
 *
 * SC-022 Phase 2. Restricted to Director and Project Manager, matching the
 * configuration-template library: a shared template shapes what contractors see
 * on every project it is applied to, so reshaping one is not something a single
 * site manager should do to everybody else.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot create permission templates.' },
      { status: 403 },
    );
  }

  let body: { name?: unknown; description?: unknown; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (typeof body.name !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Enter a name.' },
      { status: 400 },
    );
  }

  const result = await createPermissionTemplate(viewer, {
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
    items: Array.isArray(body.items) ? (body.items as never) : [],
  });
  if (result.ok) return NextResponse.json({ ok: true, id: result.id });
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not create the template.' },
    { status: result.reason === 'forbidden' ? 403 : 400 },
  );
}
