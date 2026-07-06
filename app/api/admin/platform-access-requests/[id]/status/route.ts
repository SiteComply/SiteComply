import { NextRequest, NextResponse } from 'next/server';
import { AccessRequestStatus } from '@prisma/client';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  getAccessRequestById,
  setAccessRequestStatus,
} from '@/services/accessRequests/accessRequestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set<string>(Object.values(AccessRequestStatus));

/**
 * POST /api/admin/platform-access-requests/[id]/status
 * Body: { status: "PENDING" | "APPROVED" | "REJECTED" }
 * Approve / reject (or reopen) a Platform Access Request. Admin only. Does not
 * create a Platform User — that stays with the Platform Users admin flow.
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

  if (!body.status || !ALLOWED.has(body.status)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid status.' },
      { status: 400 },
    );
  }

  const existing = await getAccessRequestById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Access request not found.' },
      { status: 404 },
    );
  }

  await setAccessRequestStatus(params.id, body.status as AccessRequestStatus);
  return NextResponse.json({ ok: true });
}
