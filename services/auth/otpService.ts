import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { normaliseUkMobile, maskUkMobile } from '@/lib/phone';
import { getSmsProvider, SmsSendError } from '@/services/sms';

/**
 * Worker SMS one-time passcode (MFA) service.
 *
 * Responsibilities:
 *  - validate & normalise the UK mobile to E.164
 *  - generate a numeric code, store only its HMAC hash with an expiry
 *  - rate-limit requests (per-mobile cooldown + hourly cap) and verification
 *    attempts to resist brute-force and SMS-pumping
 *  - verify a submitted code in constant time and report whether the worker is
 *    already known (so the next step can pre-fill their details)
 *
 * The API/UI layers never see the raw code (except the dev mock, which logs it).
 */

const CODE_LENGTH = clampInt(process.env.OTP_LENGTH, 6, 4, 8);
const TTL_SECONDS = clampInt(process.env.OTP_TTL_SECONDS, 300, 60, 900);
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** HMAC the code together with the mobile so a hash is useless on its own. */
function hashCode(mobile: string, code: string): string {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-otp-secret';
  return createHmac('sha256', secret).update(`${mobile}:${code}`).digest('hex');
}

function generateNumericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

export interface RequestCodeResult {
  ok: boolean;
  error?: string;
  /** Masked destination for display, e.g. "+44 7700 ••• 123". */
  maskedMobile?: string;
  /** Seconds until the code expires. */
  expiresInSeconds?: number;
  /** Seconds the worker must wait before requesting another code. */
  resendInSeconds?: number;
  /** Dev convenience: the code, returned ONLY when the mock provider is active. */
  devCode?: string;
}

export async function requestCode(
  rawMobile: string,
): Promise<RequestCodeResult> {
  const normalised = normaliseUkMobile(rawMobile);
  if (!normalised.ok || !normalised.e164) {
    return { ok: false, error: normalised.error };
  }
  const mobile = normalised.e164;
  const now = Date.now();

  // Cooldown: don't allow rapid re-sends.
  const latest = await prisma.otpChallenge.findFirst({
    where: { mobile },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    const sinceLast = (now - latest.createdAt.getTime()) / 1000;
    if (sinceLast < RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        error: 'Please wait a few seconds before requesting another code.',
        resendInSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast),
      };
    }
  }

  // Hourly cap per mobile.
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const recentCount = await prisma.otpChallenge.count({
    where: { mobile, createdAt: { gte: oneHourAgo } },
  });
  if (recentCount >= MAX_REQUESTS_PER_HOUR) {
    return {
      ok: false,
      error: 'Too many code requests for this number. Please try again later.',
    };
  }

  const code = generateNumericCode(CODE_LENGTH);
  const expiresAt = new Date(now + TTL_SECONDS * 1000);

  await prisma.otpChallenge.create({
    data: { mobile, codeHash: hashCode(mobile, code), expiresAt },
  });

  const provider = getSmsProvider();
  const minutes = Math.round(TTL_SECONDS / 60);
  try {
    await provider.send({
      to: mobile,
      message:
        `${code} is your SiteComply verification code. ` +
        `It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
        `Never share this code.`,
    });
  } catch (error) {
    if (error instanceof SmsSendError) {
      return {
        ok: false,
        error:
          'We couldn’t send your code right now. Please check the number and try again.',
      };
    }
    throw error;
  }

  return {
    ok: true,
    maskedMobile: maskUkMobile(mobile),
    expiresInSeconds: TTL_SECONDS,
    resendInSeconds: RESEND_COOLDOWN_SECONDS,
    // Only leak the code when explicitly using the console mock (dev/testing).
    devCode: provider.name === 'mock' ? code : undefined,
  };
}

export interface VerifyCodeResult {
  ok: boolean;
  error?: string;
  /** Verified mobile in E.164 — present on success. */
  mobile?: string;
  /** Set when an existing worker matches this mobile. */
  workerId?: string;
  /** Remaining attempts before the code is locked, on a wrong code. */
  attemptsRemaining?: number;
}

export async function verifyCode(
  rawMobile: string,
  rawCode: string,
): Promise<VerifyCodeResult> {
  const normalised = normaliseUkMobile(rawMobile);
  if (!normalised.ok || !normalised.e164) {
    return { ok: false, error: normalised.error };
  }
  const mobile = normalised.e164;
  const code = (rawCode || '').replace(/\D/g, '');

  if (code.length !== CODE_LENGTH) {
    return { ok: false, error: `Enter the ${CODE_LENGTH}-digit code.` };
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: { mobile, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    return {
      ok: false,
      error: 'Your code has expired. Please request a new one.',
    };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      ok: false,
      error: 'Too many incorrect attempts. Please request a new code.',
    };
  }

  const expected = Buffer.from(challenge.codeHash, 'hex');
  const actual = Buffer.from(hashCode(mobile, code), 'hex');
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = Math.max(0, MAX_VERIFY_ATTEMPTS - updated.attempts);
    return {
      ok: false,
      error:
        remaining > 0
          ? 'That code is incorrect. Please try again.'
          : 'Too many incorrect attempts. Please request a new code.',
      attemptsRemaining: remaining,
    };
  }

  // Success: consume this code and any other outstanding codes for the mobile.
  await prisma.otpChallenge.updateMany({
    where: { mobile, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const worker = await prisma.worker.findUnique({
    where: { mobile },
    select: { id: true },
  });

  return { ok: true, mobile, workerId: worker?.id };
}
