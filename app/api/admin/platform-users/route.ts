import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  validatePlatformUser,
  createPlatformUser,
  type PlatformUserInput,
} from '@/services/platformUsers/platformUserService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/platform-users
 * Adds a Platform User (defaults to PENDING approval). Admin only.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

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

  try {
    const user = await createPlatformUser(result.value);
    return NextResponse.json({ ok: true, id: user.id });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return NextResponse.json(
        {
          ok: false,
          errors: { email: 'A platform user with this email already exists.' },
        },
        { status: 409 },
      );
    }
    throw e;
  }
}
