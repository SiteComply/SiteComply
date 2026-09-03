import { NextRequest, NextResponse } from 'next/server';
import { verifyCode } from '@/services/auth/otpService';
import { normaliseUkMobile } from '@/lib/phone';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import { listOpenCheckIns } from '@/services/workerDashboard/workerDashboardService';
import {
  createWorkerSessionToken,
  setWorkerSessionCookie,
  getWorkerOtpMobile,
  clearWorkerOtpMobileCookie,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/otp/verify
 * Body: { mobile: string, code: string }
 *
 * On success, establishes a short-lived worker session (httpOnly cookie) and
 * reports whether the worker is already known (so the next step can pre-fill).
 *
 * The mobile is resolved COOKIE-FIRST: the number the code was actually sent to
 * was recorded server-side at request time, so verification works even if the
 * check-in page lost its `mobile` state (e.g. a deploy swapped the client bundle
 * mid-flow). The request body is only a fallback. If neither yields a valid UK
 * mobile, we return a `field: 'mobile'` error so the UI can send the worker back
 * to the number step instead of showing a phone error under the code box.
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

  // Cookie (server-remembered, tamper-proof) wins over the client-sent value.
  const resolved = getWorkerOtpMobile() ?? body.mobile ?? '';
  const normalised = normaliseUkMobile(resolved);
  if (!normalised.ok || !normalised.e164) {
    return NextResponse.json(
      {
        ok: false,
        field: 'mobile',
        error:
          'We’ve lost track of your mobile number. Please enter it again to get a new code.',
      },
      { status: 400 },
    );
  }

  const result = await verifyCode(normalised.e164, body.code ?? '');
  if (!result.ok || !result.mobile) {
    return NextResponse.json(result, { status: 401 });
  }

  // Worker session lifetime is Director-configurable (Settings → Authentication
  // & Access). Read at sign-in so a change applies to new sessions immediately.
  const { workerSessionTtlSeconds } = await getAuthRuntimeConfig();
  const token = createWorkerSessionToken({
    mobile: result.mobile,
    workerId: result.workerId,
    ttlSeconds: workerSessionTtlSeconds,
  });
  setWorkerSessionCookie(token, workerSessionTtlSeconds);
  // The worker session now carries the identity; the pending-OTP cookie is done.
  clearWorkerOtpMobileCookie();

  // Already on site? Then the check-in funnel has nothing left to ask, and the
  // client sends them to their dashboard instead of back through details and
  // site selection. This mirrors the recognition /check-in already performs —
  // it is reported here so the worker never sees those steps at all.
  const checkedIn = result.workerId
    ? (await listOpenCheckIns(result.workerId)).length > 0
    : false;

  return NextResponse.json({
    ok: true,
    workerKnown: Boolean(result.workerId),
    checkedIn,
  });
}
