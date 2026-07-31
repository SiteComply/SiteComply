import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { setMandatoryPolicy } from '@/services/siteServices/siteConfigTemplateService';
import { isSiteServiceKind } from '@/services/siteServices/siteServiceCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/org-service-policy
 *   { kind, refId, mandatory, reason? }
 *
 * SC-021 Phase 2 — company-mandatory services. DIRECTOR ONLY: this is company
 * policy applying to every site, not the configuration of one.
 *
 * Returns how many sites had the service switched off and were overridden, so
 * the UI can report the real effect rather than implying nothing changed.
 */
export async function PATCH(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (viewer.role !== 'DIRECTOR') {
    return NextResponse.json(
      { ok: false, error: 'Only Directors can set company requirements.' },
      { status: 403 },
    );
  }

  let body: {
    kind?: unknown;
    refId?: unknown;
    mandatory?: unknown;
    reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (
    !isSiteServiceKind(body.kind) ||
    typeof body.refId !== 'string' ||
    typeof body.mandatory !== 'boolean'
  ) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await setMandatoryPolicy(
    viewer,
    body.kind,
    body.refId,
    body.mandatory,
    typeof body.reason === 'string' ? body.reason : null,
  );
  if (result.ok) {
    return NextResponse.json({ ok: true, sitesAffected: result.sitesAffected });
  }
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not update the policy.' },
    { status: result.reason === 'forbidden' ? 403 : 400 },
  );
}
