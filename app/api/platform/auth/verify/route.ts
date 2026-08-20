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
  auditPlatformOverride,
} from '@/services/auth/platformDevOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/auth/verify
 * Body: { method: "email" | "mobile", value: string, code: string }
 *
 * Completes Platform Login: re-checks the account exists and is ACTIVE, then
 * verifies the code, then establishes the platform session.
 *
 * The former global `DEV_CODE = '123456'` (accepted for every active Platform
 * user) has been REMOVED. A code is now accepted only for accounts on an enabled,
 * env-configured allow-list — the personal developer override or the legacy test
 * accounts (see services/auth/platformDevOverride.ts). Every other account is
 * rejected here because real Platform OTP delivery is not built yet.
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

  // Env-gated, allow-listed code login is the ONLY path that can complete sign-in
  // until real Platform OTP delivery exists. Anything else is rejected. Every
  // attempt against an allow-listed account is audited; the code is never logged.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;

  const login = verifyPlatformCodeLogin(value, code);
  if (!login.ok) {
    // Audit only when the account is on an allow-list (a real code attempt);
    // unknown accounts hitting the dead normal-flow are not interesting noise.
    if (login.mechanism) {
      auditPlatformOverride({
        email: value,
        mechanism: login.mechanism,
        outcome: login.outcome,
        ip,
      });
    }
    return NextResponse.json(
      { ok: false, error: 'That code didn’t work. Please try again.' },
      { status: 400 },
    );
  }

  auditPlatformOverride({
    email: value,
    mechanism: login.mechanism,
    outcome: 'success',
    ip,
  });

  // Honour the admin-configured session timeout (Settings → Authentication).
  const { sessionTtlSeconds } = await getAuthRuntimeConfig();
  setPlatformSessionCookie(
    createPlatformSessionToken({ userId: user.id, ttlSeconds: sessionTtlSeconds }),
    sessionTtlSeconds,
  );
  return NextResponse.json({ ok: true });
}
