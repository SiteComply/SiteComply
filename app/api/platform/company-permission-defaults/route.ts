import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { setCompanyDefault } from '@/services/platformUsers/permissionTemplateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/company-permission-defaults
 *   { company, module, verbs }        → set a company floor
 *   { company, module, verbs: null }  → clear it
 *
 * SC-022 Phase 2 — DIRECTOR ONLY. A company default is a live rule applying
 * across every site, so it is company policy rather than site configuration.
 *
 * Returns the number of users it applies to, so the UI can state the real
 * effect instead of implying nothing changed — and so a typo in a free-text
 * company name shows up as "0 users".
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
      { ok: false, error: 'Only Directors can set company defaults.' },
      { status: 403 },
    );
  }

  let body: { company?: unknown; module?: unknown; verbs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (typeof body.company !== 'string' || typeof body.module !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const verbs =
    body.verbs === null
      ? null
      : Array.isArray(body.verbs)
        ? body.verbs.filter((v): v is string => typeof v === 'string')
        : null;

  const result = await setCompanyDefault(
    viewer,
    body.company,
    body.module,
    verbs,
  );
  if (result.ok) {
    return NextResponse.json({ ok: true, usersAffected: result.usersAffected });
  }
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not update the default.' },
    { status: result.reason === 'forbidden' ? 403 : 400 },
  );
}
