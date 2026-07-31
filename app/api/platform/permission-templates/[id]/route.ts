import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';
import {
  updatePermissionTemplate,
  setPermissionTemplateActive,
  deletePermissionTemplate,
} from '@/services/platformUsers/permissionTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/platform/permission-templates/[id] — edit, or activate/deactivate
 * DELETE /api/platform/permission-templates/[id] — remove (never a built-in)
 *
 * SC-022 Phase 2. Director / Project Manager only.
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
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot change permission templates.' },
      { status: 403 },
    );
  }

  let body: {
    name?: unknown;
    description?: unknown;
    items?: unknown;
    active?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (typeof body.active === 'boolean' && body.name === undefined) {
    const r = await setPermissionTemplateActive(viewer, params.id, body.active);
    if (r.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { ok: false, error: r.error ?? 'Could not update the template.' },
      { status: r.reason === 'not_found' ? 404 : 403 },
    );
  }

  if (typeof body.name !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Enter a name.' },
      { status: 400 },
    );
  }
  const result = await updatePermissionTemplate(viewer, params.id, {
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
    items: Array.isArray(body.items) ? (body.items as never) : [],
  });
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not update the template.' },
    {
      status:
        result.reason === 'forbidden'
          ? 403
          : result.reason === 'not_found'
            ? 404
            : 400,
    },
  );
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
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot delete permission templates.' },
      { status: 403 },
    );
  }
  const r = await deletePermissionTemplate(viewer, params.id);
  if (r.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { ok: false, error: r.error ?? 'Could not delete the template.' },
    {
      status:
        r.reason === 'not_found' ? 404 : r.reason === 'invalid' ? 400 : 403,
    },
  );
}
