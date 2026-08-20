import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { normaliseUkMobile, maskUkMobile } from '@/lib/phone';
import { sendAuditedSms } from '@/services/sms/smsSendService';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';

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
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_REQUESTS_PER_HOUR = 5;

// OTP expiry (TTL) and the max wrong-code attempts are runtime-configurable via
// Admin → Settings → Authentication (AuthConfig, DB-over-env-over-default). They
// are read per call from getAuthRuntimeConfig() so admin changes apply live.

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

/** Which login surface is requesting a code — controls only the enable gate. */
export type OtpAudience = 'worker' | 'platform';

export async function requestCode(
  rawMobile: string,
  opts: { audience?: OtpAudience } = {},
): Promise<RequestCodeResult> {
  const audience = opts.audience ?? 'worker';
  const normalised = normaliseUkMobile(rawMobile);
  if (!normalised.ok || !normalised.e164) {
    return { ok: false, error: normalised.error };
  }
  const mobile = normalised.e164;
  const now = Date.now();

  const authConfig = await getAuthRuntimeConfig();
  // Enable gate.
  //   smsOtpEnabled          — the Admin Centre's kill switch for the SMS
  //                            channel itself (infrastructure). Applies to BOTH
  //                            audiences.
  //   workerSmsLoginEnabled  — a Director turning off SMS as a way for WORKERS
  //                            to sign in (policy). Applies to the worker surface
  //                            ONLY — it must not gate Platform-user sign-in.
  const gated =
    !authConfig.smsOtpEnabled ||
    (audience === 'worker' && !authConfig.workerSmsLoginEnabled);
  if (gated) {
    return {
      ok: false,
      error:
        'SMS verification is currently unavailable. Please contact your site administrator.',
    };
  }
  const ttlSeconds = authConfig.otpTtlSeconds;

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
  const expiresAt = new Date(now + ttlSeconds * 1000);

  await prisma.otpChallenge.create({
    data: { mobile, codeHash: hashCode(mobile, code), expiresAt },
  });

  const minutes = Math.round(ttlSeconds / 60);
  // Routed through the audited sender so the attempt is recorded and the master
  // switch is honoured. The CODE ITSELF is never logged — only that a sign-in
  // code was sent, to a masked number, and whether it worked.
  const sent = await sendAuditedSms({
    to: mobile,
    purpose: 'OTP',
    message:
      `${code} is your SiteComply verification code. ` +
      `It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
      `Never share this code.`,
  });
  if (!sent.ok) {
    return {
      ok: false,
      error: sent.disabled
        ? 'Sign-in codes are temporarily unavailable. Please contact your site manager.'
        : 'We couldn’t send your code right now. Please check the number and try again.',
    };
  }

  return {
    ok: true,
    maskedMobile: maskUkMobile(mobile),
    expiresInSeconds: ttlSeconds,
    resendInSeconds: RESEND_COOLDOWN_SECONDS,
    // Only leak the code when explicitly using the console mock (dev/testing).
    // Taken from the audited send result, so it stays tied to the provider that
    // actually handled THIS message rather than a second, separate lookup.
    devCode: sent.provider === 'mock' ? code : undefined,
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

/** Identity-agnostic outcome of checking a code against a stored challenge. */
export interface VerifyChallengeResult {
  ok: boolean;
  error?: string;
  /** Verified mobile in E.164 — present on success. */
  mobile?: string;
  /** Remaining attempts before the code is locked, on a wrong code. */
  attemptsRemaining?: number;
}

/**
 * Core OTP verification: validates the code against the outstanding challenge
 * for a mobile, applying expiry, attempt caps and constant-time comparison, and
 * consumes the challenge on success. It knows NOTHING about workers or platform
 * users — callers resolve the identity that owns the verified number. Shared by
 * the worker and platform login surfaces.
 */
export async function verifyChallenge(
  rawMobile: string,
  rawCode: string,
): Promise<VerifyChallengeResult> {
  const normalised = normaliseUkMobile(rawMobile);
  if (!normalised.ok || !normalised.e164) {
    return { ok: false, error: normalised.error };
  }
  const mobile = normalised.e164;
  const code = (rawCode || '').replace(/\D/g, '');

  if (code.length !== CODE_LENGTH) {
    return { ok: false, error: `Enter the ${CODE_LENGTH}-digit code.` };
  }

  const maxVerifyAttempts = (await getAuthRuntimeConfig()).otpMaxAttempts;

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

  if (challenge.attempts >= maxVerifyAttempts) {
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
    const remaining = Math.max(0, maxVerifyAttempts - updated.attempts);
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

  return { ok: true, mobile };
}

/**
 * Worker verification: the core check plus a worker lookup, so the caller can
 * establish a worker session and pre-fill known details. Unchanged behaviour.
 */
export async function verifyCode(
  rawMobile: string,
  rawCode: string,
): Promise<VerifyCodeResult> {
  const result = await verifyChallenge(rawMobile, rawCode);
  if (!result.ok || !result.mobile) return result;

  const worker = await prisma.worker.findUnique({
    where: { mobile: result.mobile },
    select: { id: true },
  });

  return { ok: true, mobile: result.mobile, workerId: worker?.id };
}
