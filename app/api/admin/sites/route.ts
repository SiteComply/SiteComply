import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { validateSite, createSite } from '@/services/sites/adminSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sites
 * Creates a job site (with a default UK induction checklist). Admin only.
 */
export async function POST(req: NextRequest) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = validateSite(body ?? {});
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const site = await createSite(result.value, admin.adminId);
  return NextResponse.json({ ok: true, id: site.id });
}
