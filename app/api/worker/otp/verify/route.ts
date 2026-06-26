import { NextRequest, NextResponse } from 'next/server';
import { verifyCode } from '@/services/auth/otpService';
import {
  createWorkerSessionToken,
  setWorkerSessionCookie,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/otp/verify
 * Body: { mobile: string, code: string }
 * On success, establishes a short-lived worker session (httpOnly cookie) and
 * reports whether the worker is already known (so the next step can pre-fill).
 */
export async function POST(req: NextRequest) {
  let body: { mobile?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await verifyCode(body.mobile ?? '', body.code ?? '');
  if (!result.ok || !result.mobile) {
    return NextResponse.json(result, { status: 401 });
  }

  const token = createWorkerSessionToken({
    mobile: result.mobile,
    workerId: result.workerId,
  });
  setWorkerSessionCookie(token);

  return NextResponse.json({
    ok: true,
    workerKnown: Boolean(result.workerId),
  });
}
