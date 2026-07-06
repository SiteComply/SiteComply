import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  validatePlatformUser,
  type PlatformUserInput,
} from '@/services/platformUsers/platformUserService';
import {
  getAccessRequestById,
  approveAccessRequest,
} from '@/services/accessRequests/accessRequestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/platform-access-requests/[id]/approve
 * Body: PlatformUserInput (name, company, email, mobile, role, assignedSiteIds).
 *
 * Runs the approval workflow: validates the (possibly edited) user details, then
 * creates + activates the Platform User, moves the request to APPROVED and links
 * it to the new user, recording the approving admin. Admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  const existing = await getAccessRequestById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Access request not found.' },
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

  const result = validatePlatformUser((body ?? {}) as PlatformUserInput);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const outcome = await approveAccessRequest(
    params.id,
    result.value,
    admin.adminId,
  );

  if (!outcome.ok) {
    if (outcome.reason === 'email_taken') {
      return NextResponse.json(
        {
          ok: false,
          errors: { email: 'A platform user with this email already exists.' },
        },
        { status: 409 },
      );
    }
    // not_pending — already reviewed by someone else.
    return NextResponse.json(
      {
        ok: false,
        error: 'This request has already been reviewed.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, userId: outcome.userId });
}
