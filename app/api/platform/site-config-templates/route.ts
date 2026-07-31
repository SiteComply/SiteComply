import { NextRequest, NextResponse } from 'next/server';
import { SiteConfigTemplateCategory } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  createConfigTemplate,
  saveSiteAsConfigTemplate,
} from '@/services/siteServices/siteConfigTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/site-config-templates
 *   { name, description?, category, items }        → create from an item list
 *   { name, description?, category, fromSiteId }   → capture a site's config
 *
 * SC-021 Phase 2. Creating is gated on `sites:edit` — anyone who may configure a
 * site may capture that configuration for reuse. Editing or deleting a SHARED
 * template is the restricted act and lives on the [id] route.
 */
function isCategory(v: unknown): v is SiteConfigTemplateCategory {
  return (
    v === 'PROJECT_TYPE' || v === 'CLIENT' || v === 'INDUSTRY' || v === 'OTHER'
  );
}

export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot create configuration templates.' },
      { status: 403 },
    );
  }

  let body: {
    name?: unknown;
    description?: unknown;
    category?: unknown;
    items?: unknown;
    fromSiteId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (typeof body.name !== 'string' || !isCategory(body.category)) {
    return NextResponse.json(
      { ok: false, error: 'Name and category are required.' },
      { status: 400 },
    );
  }
  const description =
    typeof body.description === 'string' ? body.description : null;

  const result =
    typeof body.fromSiteId === 'string' && body.fromSiteId
      ? await saveSiteAsConfigTemplate(viewer, body.fromSiteId, {
          name: body.name,
          description,
          category: body.category,
        })
      : await createConfigTemplate(viewer, {
          name: body.name,
          description,
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
    { ok: false, error: result.error ?? 'Could not create the template.' },
    { status },
  );
}
