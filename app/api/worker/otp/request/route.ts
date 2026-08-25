import { NextRequest, NextResponse } from 'next/server';
import { requestCode } from '@/services/auth/otpService';
import { normaliseUkMobile } from '@/lib/phone';
import { setWorkerOtpMobileCookie } from '@/lib/session';

// Uses Node crypto + Prisma, so force the Node.js runtime (not Edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/otp/request
 * Body: { mobile: string }  — a UK mobile in any common format.
 * Sends a one-time passcode and returns a masked destination + timings.
 */
export async function POST(req: NextRequest) {
  let body: { mobile?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await requestCode(body.mobile ?? '');
  if (!result.ok) {
    // 429 for rate-limit-style failures, 400 for validation.
    const status = result.resendInSeconds ? 429 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        resendInSeconds: result.resendInSeconds,
      },
      { status },
    );
  }

  // Remember (server-side) the exact number this code was sent to, so verify
  // never depends on the client still holding the mobile in component state.
  // `requestCode` succeeded, so this re-normalisation is guaranteed to parse.
  const normalised = normaliseUkMobile(body.mobile ?? '');
  if (normalised.ok && normalised.e164) {
    setWorkerOtpMobileCookie(normalised.e164);
  }

  // EXPLICIT CONTRACT — field by field, never `NextResponse.json(result)`.
  //
  // This route used to return the service result wholesale. Nothing in it was
  // secret *given the configured provider*, which made the response shape
  // depend on provider selection: a config change alone could start putting new
  // service-internal fields on a public, unauthenticated endpoint. Listing the
  // fields means adding one to the service can never widen this response.
  // Mirrors app/api/platform/auth/start/route.ts.
  return NextResponse.json({
    ok: true,
    maskedMobile: result.maskedMobile,
    expiresInSeconds: result.expiresInSeconds,
    resendInSeconds: result.resendInSeconds,
  });
}
