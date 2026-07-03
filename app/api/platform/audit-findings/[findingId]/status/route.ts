import { NextRequest, NextResponse } from 'next/server';
import { FindingStatus } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { setFindingStatus } from '@/services/audits/findingService';
import { isFindingStatus } from '@/services/audits/findingConstants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audit-findings/[findingId]/status
 * Body: { status: "OPEN" | "IN_PROGRESS" | "CLOSED" }
 * Quick status change (e.g. close / reopen a finding). Enforces the audits
 * "edit" permission and the Assigned-Sites boundary.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { findingId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to update audit findings.' },
      { status: 403 },
    );
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (!body.status || !isFindingStatus(body.status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }

  const updated = await setFindingStatus(
    viewer,
    params.findingId,
    body.status as FindingStatus,
  );
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Finding not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
