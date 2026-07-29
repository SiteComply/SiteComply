import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateFinding,
  createFinding,
  type FindingInput,
} from '@/services/audits/findingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audits/[id]/findings
 * Add a finding to an audit. Enforces the audits "edit" permission and the
 * Assigned-Sites boundary (the parent audit must be in the viewer's scope).
 */
export async function POST(
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
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      {
        ok: false,
        error: 'You do not have permission to manage audit findings.',
      },
      { status: 403 },
    );
  }

  let body: FindingInput;
  try {
    body = (await req.json()) as FindingInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = validateFinding(body);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const created = await createFinding(viewer, params.id, result.value);
  if (!created) {
    return NextResponse.json(
      { ok: false, error: 'Audit not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: created.id });
}
