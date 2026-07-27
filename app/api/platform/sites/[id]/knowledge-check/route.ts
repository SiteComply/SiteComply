import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { saveConfig } from '@/services/knowledgeChecks/knowledgeCheckConfigService';
import {
  regenerateForViewer,
  approveBankForViewer,
} from '@/services/knowledgeChecks/bankAdminService';
import { getEffectiveConfig } from '@/services/knowledgeChecks/knowledgeCheckConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/sites/[id]/knowledge-check
 *   body { action: 'config', config: {...} }      → save per-site overrides
 *   body { action: 'regenerate' }                  → (re)generate the bank
 *   body { action: 'approve' }                     → publish a pending bank
 *
 * Gated on the `sites` edit permission + site scope (site managers included).
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

  let body: { action?: string; config?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (body.action === 'config') {
    const result = await saveConfig(viewer, params.id, body.config ?? {});
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

  if (body.action === 'regenerate') {
    const cfg = await getEffectiveConfig(params.id);
    const result = await regenerateForViewer(
      viewer,
      params.id,
      cfg.requireManagerApproval,
    );
    if (!result.ok) {
      if (result.reason === 'unavailable') {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Question generation is unavailable right now. Please try again.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { ok: false, error: 'Could not regenerate.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'approve') {
    const result = await approveBankForViewer(viewer, params.id);
    if (!result.ok) {
      const status = result.reason === 'forbidden' ? 403 : 404;
      return NextResponse.json(
        { ok: false, error: 'Could not approve.' },
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
