import { NextRequest, NextResponse } from 'next/server';
import { requestCode } from '@/services/auth/otpService';
import { normaliseUkMobile } from '@/lib/phone';
import { setWorkerOtpMobileCookie } from '@/lib/session';
import { canDiscloseOtpCode } from '@/lib/config';

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
    return NextResponse.json(result, { status });
  }

  // Remember (server-side) the exact number this code was sent to, so verify
  // never depends on the client still holding the mobile in component state.
  // `requestCode` succeeded, so this re-normalisation is guaranteed to parse.
  const normalised = normaliseUkMobile(body.mobile ?? '');
  if (normalised.ok && normalised.e164) {
    setWorkerOtpMobileCookie(normalised.e164);
  }

  // SECOND LAYER, on purpose. requestCode() already refuses to populate
  // devCode outside development and test, and that is the real control. This
  // is the boundary where the value would actually leave the building, so it
  // is also the last place the guarantee can be made unconditionally — no
  // future caller, refactor or new provider can widen it upstream without this
  // still holding. Cheap, and the failure it prevents is a sign-in bypass.
  if (!canDiscloseOtpCode() && result.devCode !== undefined) {
    const { devCode: _withheld, ...safe } = result;
    return NextResponse.json(safe);
  }

  return NextResponse.json(result);
}
