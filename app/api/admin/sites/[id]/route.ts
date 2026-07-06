import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  validateSite,
  updateSite,
  getSiteById,
  countCheckedInWorkers,
  deleteSite,
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
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

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

/**
 * DELETE /api/admin/sites/[id]
 * Permanently deletes a job site and all of its history. Admin only. Refused
 * with 409 while any worker is still checked in to the site.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const existing = await getSiteById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Site not found.' },
      { status: 404 },
    );
  }

  const checkedIn = await countCheckedInWorkers(params.id);
  if (checkedIn > 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Workers are currently checked in to this site. Please ensure all workers have checked out before deleting the site',
      },
      { status: 409 },
    );
  }

  await deleteSite(params.id);
  return NextResponse.json({ ok: true });
}
