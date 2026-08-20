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
 * why.
 *
 * This endpoint NO LONGER returns a verification code. The former global
 * `DEV_CODE = '123456'` — which was returned here and accepted for EVERY active
 * Platform user — has been removed; it was an unauthenticated bypass. Real
 * Platform OTP delivery (SMS/email) is not built yet, so today the only account
 * that can complete sign-in is the one allow-listed by the account-scoped dev
 * override (see services/auth/platformDevOverride.ts), which supplies its own
 * code out-of-band and is verified in /verify. No code is disclosed here.
 */
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

  // status === ACTIVE — allow the client to advance to the code step. No code
  // is returned: the allow-listed override account supplies its own code
  // out-of-band; all other accounts have no working code until real Platform
  // OTP delivery is built.
  return NextResponse.json({ ok: true });
}
