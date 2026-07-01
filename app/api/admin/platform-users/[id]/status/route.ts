import { NextRequest, NextResponse } from 'next/server';
import { PlatformUserStatus } from '@prisma/client';
import { getAdminSession } from '@/lib/session';
import {
  setPlatformUserStatus,
  getPlatformUserById,
} from '@/services/platformUsers/platformUserService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set<string>(Object.values(PlatformUserStatus));

/**
 * POST /api/admin/platform-users/[id]/status
 * Body: { status: "PENDING" | "ACTIVE" | "DISABLED" }
 * Approve (-> ACTIVE), disable (-> DISABLED) or reset a Platform User.
 */
export async function POST(
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

  const existing = await getPlatformUserById(params.id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Platform user not found.' },
      { status: 404 },
    );
  }

  await setPlatformUserStatus(params.id, body.status as PlatformUserStatus);
  return NextResponse.json({ ok: true });
}
