import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { validateSite, createSite } from '@/services/sites/adminSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sites
 * Creates a job site (with a default UK induction checklist). Admin only.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

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
