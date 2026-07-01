import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getAdminSession } from '@/lib/session';
import {
  validatePlatformUser,
  updatePlatformUser,
  deletePlatformUser,
  getPlatformUserById,
  type PlatformUserInput,
} from '@/services/platformUsers/platformUserService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/platform-users/[id]
 * Updates a Platform User's details, role, status and assigned sites.
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

  const existing = await getPlatformUserById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Platform user not found.' },
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

  try {
    await updatePlatformUser(params.id, result.value);
    return NextResponse.json({ ok: true, id: params.id });
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

/**
 * DELETE /api/admin/platform-users/[id]
 * Permanently removes a Platform User.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  const existing = await getPlatformUserById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Platform user not found.' },
      { status: 404 },
    );
  }

  await deletePlatformUser(params.id);
  return NextResponse.json({ ok: true });
}
