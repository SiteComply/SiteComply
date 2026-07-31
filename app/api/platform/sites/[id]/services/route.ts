import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { setSiteServiceEnabled } from '@/services/siteServices/siteServiceAvailability';
import { isSiteServiceKind } from '@/services/siteServices/siteServiceCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/services
 *   { kind: 'PERMIT_TYPE' | 'ACTIVITY_TYPE', refId, enabled }
 *
 * SC-021 Phase 1 — turn one permit type or inspection type on/off for one site.
 *
 * Gated on `sites:edit` + site scope, the pair Site Managers hold for their own
 * sites and Directors hold everywhere — exactly the two roles SC-021 names. An
 * out-of-scope site returns 404 rather than 403, matching the rest of the
 * platform: a 403 would confirm the site exists.
 *
 * A blocked disable returns 409, not 400. It is a conflict with live state
 * (active schedules), not malformed input, and the message names the schedules
 * so the manager can act on it.
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
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot configure this site.' },
      { status: 403 },
    );
  }

  let body: { kind?: unknown; refId?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (!isSiteServiceKind(body.kind)) {
    return NextResponse.json(
      { ok: false, error: 'Unknown service type.' },
      { status: 400 },
    );
  }
  if (typeof body.refId !== 'string' || body.refId === '') {
    return NextResponse.json(
      { ok: false, error: 'Missing service id.' },
      { status: 400 },
    );
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'Missing enabled flag.' },
      { status: 400 },
    );
  }

  const result = await setSiteServiceEnabled(
    viewer,
    params.id,
    body.kind,
    body.refId,
    body.enabled,
  );

  if (result.ok) return NextResponse.json({ ok: true, groups: result.groups });

  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : result.reason === 'blocked'
          ? 409
          : 400;
  return NextResponse.json(
    {
      ok: false,
      error:
        'error' in result ? result.error : 'Could not update this setting.',
    },
    { status },
  );
}
