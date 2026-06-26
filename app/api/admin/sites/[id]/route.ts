import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import {
  validateSite,
  updateSite,
  getSiteById,
} from '@/services/sites/adminSiteService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/sites/[id]
 * Updates a job site's details. Admin only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  const existing = await getSiteById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Site not found.' },
      { status: 404 },
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

  await updateSite(params.id, result.value);
  return NextResponse.json({ ok: true, id: params.id });
}
