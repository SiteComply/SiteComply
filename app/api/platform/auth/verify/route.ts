import { NextRequest, NextResponse } from 'next/server';
import { normaliseUkMobile } from '@/lib/phone';
import {
  findPlatformUserByEmail,
  findPlatformUserByMobile,
} from '@/services/platformUsers/platformUserService';
import {
  createPlatformSessionToken,
  setPlatformSessionCookie,
} from '@/lib/session';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import {
  verifyPlatformCodeLogin,
  isPlatformOverrideAccount,
  auditPlatformOverride,
} from '@/services/auth/platformDevOverride';
import { verifyChallenge } from '@/services/auth/otpService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/auth/verify
 * Body: { method: "email" | "mobile", value: string, code: string }
 *
 * Completes Platform Login: re-checks the account exists and is ACTIVE, then
 * verifies the code, then establishes the platform session.
 *
 * Two mutually-exclusive code paths, keyed off the resolved account's email:
 *  - Override accounts (personal / test allow-list) use their fixed env code,
 *    audited (see services/auth/platformDevOverride.ts).
 *  - Everyone else uses the REAL SMS OTP: the code sent by /start is checked
 *    against the shared OTP challenge for the account's mobile (verifyChallenge).
 * The former global `DEV_CODE = '123456'` bypass remains removed.
 */

export async function POST(req: NextRequest) {
  let body: { method?: string; value?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const value = (body.value ?? '').trim();
  const code = (body.code ?? '').trim();

  let user;
  if (body.method === 'email') {
    user = await findPlatformUserByEmail(value);
  } else if (body.method === 'mobile') {
    const m = normaliseUkMobile(value);
    user = m.ok && m.e164 ? await findPlatformUserByMobile(m.e164) : null;
  } else {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  // Re-validate the account is still allowed in (status may have changed).
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json(
      { ok: false, error: 'This account can no longer sign in.' },
      { status: 403 },
    );
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;

  if (isPlatformOverrideAccount(user.email)) {
    // Fixed-code override path (keyed off the resolved account email, so it works
    // whether they identified by email or mobile). Audited; code never logged.
    const login = verifyPlatformCodeLogin(user.email, code);
    if (!login.ok) {
      auditPlatformOverride({
        email: user.email,
        mechanism: login.mechanism,
        outcome: login.outcome,
        ip,
      });
      return NextResponse.json(
        { ok: false, error: 'That code didn’t work. Please try again.' },
        { status: 400 },
      );
    }
    auditPlatformOverride({
      email: user.email,
      mechanism: login.mechanism,
      outcome: 'success',
      ip,
    });
  } else {
    // Real SMS OTP path: check the code against the challenge sent to the
    // account's mobile by /start.
    if (!user.mobile) {
      return NextResponse.json(
        { ok: false, error: 'That code didn’t work. Please try again.' },
        { status: 400 },
      );
    }
    const otp = await verifyChallenge(user.mobile, code);
    if (!otp.ok) {
      return NextResponse.json(
        { ok: false, error: otp.error ?? 'That code didn’t work. Please try again.' },
        { status: 400 },
      );
    }
  }

  // Honour the admin-configured session timeout (Settings → Authentication).
  const { sessionTtlSeconds } = await getAuthRuntimeConfig();
  setPlatformSessionCookie(
    createPlatformSessionToken({ userId: user.id, ttlSeconds: sessionTtlSeconds }),
    sessionTtlSeconds,
  );
  return NextResponse.json({ ok: true });
}
