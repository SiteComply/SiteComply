import { NextRequest, NextResponse } from 'next/server';
import { requestCode } from '@/services/auth/otpService';

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
  return NextResponse.json(result);
}
