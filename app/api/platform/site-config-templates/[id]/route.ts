import { NextRequest, NextResponse } from 'next/server';
import { SiteConfigTemplateCategory } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';
import {
  updateConfigTemplate,
  setConfigTemplateActive,
  deleteConfigTemplate,
} from '@/services/siteServices/siteConfigTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/platform/site-config-templates/[id]  → edit, or activate/deactivate
 * DELETE /api/platform/site-config-templates/[id]  → remove
 *
 * SC-021 Phase 2. Restricted to Directors and Project Managers: a configuration
 * template decides which permits and inspections a whole project may use, so
 * reshaping a shared one must not be something a single site manager can do to
 * everybody else.
 *
 * Deleting is safe for configured sites — their settings are their own rows and
 * their provenance is a stored string, not a link.
 */
function isCategory(v: unknown): v is SiteConfigTemplateCategory {
  return (
    v === 'PROJECT_TYPE' || v === 'CLIENT' || v === 'INDUSTRY' || v === 'OTHER'
  );
}

function gate(role: Parameters<typeof canManageSiteConfigTemplates>[0]) {
  return canManageSiteConfigTemplates(role);
}

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
  if (!gate(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot change shared configuration templates.' },
      { status: 403 },
    );
  }

  let body: {
    name?: unknown;
    description?: unknown;
    category?: unknown;
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

  // Activate/deactivate is a distinct, smaller action than a full edit.
  if (typeof body.active === 'boolean' && body.name === undefined) {
    const r = await setConfigTemplateActive(viewer, params.id, body.active);
    if (r.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { ok: false, error: r.error ?? 'Could not update the template.' },
      { status: r.reason === 'not_found' ? 404 : 403 },
    );
  }

  if (typeof body.name !== 'string' || !isCategory(body.category)) {
    return NextResponse.json(
      { ok: false, error: 'Name and category are required.' },
      { status: 400 },
    );
  }

  const result = await updateConfigTemplate(viewer, params.id, {
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
    category: body.category,
    items: Array.isArray(body.items) ? (body.items as never) : [],
  });
  if (result.ok) return NextResponse.json({ ok: true, id: result.id });
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
  if (!gate(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot delete shared configuration templates.' },
      { status: 403 },
    );
  }
  const result = await deleteConfigTemplate(viewer, params.id);
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { ok: false, error: 'Could not delete the template.' },
    { status: result.reason === 'not_found' ? 404 : 403 },
  );
}
