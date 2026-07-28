import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  saveValidity,
  invalidateInductions,
} from '@/services/induction/inductionConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/induction-validity
 *   body { action: 'validity', days: number|null }  → set/clear the validity period
 *   body { action: 'invalidate' }                    → invalidate previous inductions
 *
 * Induction validity (SC-006). Gated on the `sites` edit permission + site scope
 * (site managers included).
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

  let body: { action?: string; days?: number | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (body.action === 'validity') {
    const days =
      body.days === null || body.days === undefined ? null : Number(body.days);
    const result = await saveValidity(viewer, params.id, days);
    if (!result.ok) {
      const status =
        result.reason === 'forbidden'
          ? 403
          : result.reason === 'not_found'
            ? 404
            : 400;
      return NextResponse.json(
        { ok: false, error: 'Could not save.' },
        { status },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'invalidate') {
    const result = await invalidateInductions(viewer, params.id);
    if (!result.ok) {
      const status = result.reason === 'forbidden' ? 403 : 404;
      return NextResponse.json(
        { ok: false, error: 'Could not invalidate.' },
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
