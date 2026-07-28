import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  saveGpsConfig,
  grantOverride,
  revokeOverride,
} from '@/services/geo/geoConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/gps
 *   { action: 'config', config: {...} }                 → save GPS settings
 *   { action: 'grantOverride', workerId, reason, days } → authorise off-site check-in
 *   { action: 'revokeOverride', overrideId }            → cancel an unused override
 *
 * GPS check-in validation (SC-007). Gated on the `sites` edit permission + site
 * scope. Override reasons are mandatory (validated in the service).
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

  let body: {
    action?: string;
    config?: Record<string, unknown>;
    workerId?: string;
    reason?: string;
    days?: number | null;
    overrideId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (body.action === 'config') {
    const result = await saveGpsConfig(viewer, params.id, body.config ?? {});
    if (!result.ok) {
      const status =
        result.reason === 'forbidden'
          ? 403
          : result.reason === 'not_found'
            ? 404
            : 400;
      return NextResponse.json(
        {
          ok: false,
          error:
            result.reason === 'invalid'
              ? 'Please check the coordinates and radius.'
              : 'Could not save.',
        },
        { status },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'grantOverride') {
    if (!body.workerId) {
      return NextResponse.json(
        { ok: false, error: 'No worker selected.' },
        { status: 400 },
      );
    }
    const expiresAt =
      typeof body.days === 'number' && body.days > 0
        ? new Date(Date.now() + body.days * 24 * 60 * 60 * 1000)
        : null;
    const result = await grantOverride(
      viewer,
      params.id,
      body.workerId,
      body.reason ?? '',
      expiresAt,
    );
    if (!result.ok) {
      const status =
        result.reason === 'forbidden'
          ? 403
          : result.reason === 'not_found'
            ? 404
            : 400;
      return NextResponse.json(
        {
          ok: false,
          error:
            result.reason === 'invalid'
              ? 'A reason is required.'
              : 'Could not grant override.',
        },
        { status },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'revokeOverride') {
    if (!body.overrideId) {
      return NextResponse.json(
        { ok: false, error: 'No override specified.' },
        { status: 400 },
      );
    }
    const result = await revokeOverride(viewer, body.overrideId);
    if (!result.ok) {
      const status = result.reason === 'forbidden' ? 403 : 404;
      return NextResponse.json(
        { ok: false, error: 'Could not revoke.' },
        { status },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { ok: false, error: 'Unknown action.' },
    { status: 400 },
  );
}
