import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  getAccessRequestById,
  deleteAccessRequest,
} from '@/services/accessRequests/accessRequestService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/platform-access-requests/[id]
 * Permanently delete a Platform Access Request (used to clear decided
 * Approved/Rejected requests). Admin only. Any Platform User created from an
 * approval is left intact.
 */
async function DELETEHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const existing = await getAccessRequestById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Access request not found.' },
      { status: 404 },
    );
  }

  await deleteAccessRequest(params.id);
  return NextResponse.json({ ok: true });
}

export const DELETE = withClosedProjectHandling(DELETEHandler);
