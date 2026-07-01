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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/auth/verify
 * Body: { method: "email" | "mobile", value: string, code: string }
 *
 * Completes Platform Login: re-checks the account exists and is ACTIVE, verifies
 * the (development) code, then establishes the platform session. No real
 * email/SMS is involved. Site scope is resolved per request from this session.
 */
const DEV_CODE = '123456';

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

  if (code !== DEV_CODE) {
    return NextResponse.json(
      { ok: false, error: 'That code didn’t work. Please try again.' },
      { status: 400 },
    );
  }

  setPlatformSessionCookie(createPlatformSessionToken({ userId: user.id }));
  return NextResponse.json({ ok: true });
}
