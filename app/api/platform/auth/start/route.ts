import { NextRequest, NextResponse } from 'next/server';
import { normaliseUkMobile } from '@/lib/phone';
import {
  findPlatformUserByEmail,
  findPlatformUserByMobile,
} from '@/services/platformUsers/platformUserService';
import { requestCode } from '@/services/auth/otpService';
import { isPlatformOverrideAccount } from '@/services/auth/platformDevOverride';

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
 * SMS-first real OTP. For an ACTIVE account with a mobile on file, a real code
 * is sent by SMS (Twilio) via the shared OTP service to that mobile — regardless
 * of whether they identified by email or mobile. The code is NEVER returned here.
 *
 * The scoped dev overrides remain: an override account (personal or test
 * allow-list) uses its own fixed code out-of-band, so no SMS is sent for it. An
 * ACTIVE non-override account with no mobile has no SMS channel and is told so.
 * The global `DEV_CODE = '123456'` bypass remains removed.
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

  // status === ACTIVE.

  // Override accounts (personal / test allow-list) use their fixed code
  // out-of-band — never send them a real SMS. Advance to the code step.
  if (isPlatformOverrideAccount(user.email)) {
    return NextResponse.json({ ok: true });
  }

  // Real path: send an SMS OTP to the account's mobile on file.
  if (!user.mobile) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'no_mobile',
        error:
          'This account has no mobile number for SMS sign-in. Please contact your administrator.',
      },
      { status: 400 },
    );
  }

  const sent = await requestCode(user.mobile, { audience: 'platform' });
  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, reason: 'send_failed', error: sent.error, resendInSeconds: sent.resendInSeconds },
      { status: sent.resendInSeconds ? 429 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    channel: 'sms',
    maskedMobile: sent.maskedMobile,
    expiresInSeconds: sent.expiresInSeconds,
    resendInSeconds: sent.resendInSeconds,
  });
}
