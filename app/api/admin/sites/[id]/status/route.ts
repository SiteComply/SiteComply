import { NextRequest, NextResponse } from 'next/server';
import { SiteStatus } from '@prisma/client';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { setSiteStatus, getSiteById } from '@/services/sites/adminSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sites/[id]/status
 * Body: { status: "ACTIVE" | "ARCHIVED" }
 * Archives or restores a site. Archived sites disappear from worker selection.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (
    body.status !== SiteStatus.ACTIVE &&
    body.status !== SiteStatus.ARCHIVED
  ) {
    return NextResponse.json(
      { ok: false, error: 'Invalid status.' },
      { status: 400 },
    );
  }

  const existing = await getSiteById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Site not found.' },
      { status: 404 },
    );
  }

  await setSiteStatus(params.id, body.status);
  return NextResponse.json({ ok: true });
}
