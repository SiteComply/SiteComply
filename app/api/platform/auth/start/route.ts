import { NextRequest, NextResponse } from 'next/server';
import { normaliseUkMobile } from '@/lib/phone';
import {
  findPlatformUserByEmail,
  findPlatformUserByMobile,
} from '@/services/platformUsers/platformUserService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/auth/start
 * Body: { method: "email" | "mobile", value: string }
 *
 * Validates Platform Login against the Platform Users table: only a user that
 * exists AND has status ACTIVE may proceed. Pending and Disabled users are told
 * why. On success the (development) verification code is returned, mirroring the
 * worker OTP dev flow — no real email/SMS is sent, and role/site permissions are
 * NOT enforced here yet.
 */
const DEV_CODE = '123456';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { method?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 });
  }

  const method = body.method;
  const value = (body.value ?? '').trim();

  let user;
  if (method === 'email') {
    if (!EMAIL_RE.test(value.toLowerCase())) {
      return NextResponse.json(
        { ok: false, reason: 'invalid' },
        { status: 400 },
      );
    }
    user = await findPlatformUserByEmail(value);
  } else if (method === 'mobile') {
    const m = normaliseUkMobile(value);
    if (!m.ok || !m.e164) {
      return NextResponse.json(
        { ok: false, reason: 'invalid' },
        { status: 400 },
      );
    }
    user = await findPlatformUserByMobile(m.e164);
  } else {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 });
  }

  if (!user) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
  if (user.status === 'PENDING') {
    return NextResponse.json({ ok: false, reason: 'pending' }, { status: 403 });
  }
  if (user.status === 'DISABLED') {
    return NextResponse.json(
      { ok: false, reason: 'disabled' },
      { status: 403 },
    );
  }

  // status === ACTIVE — allow the user to continue with the dev code.
  return NextResponse.json({ ok: true, code: DEV_CODE });
}
