import { prisma } from '@/lib/prisma';
import {
  resolveCscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
} from './index';
import { getCscsRuntimeConfig } from './cscsConfigService';
import { messageForStatus } from './smartCheckMapper';

/**
 * SC-001 — orchestrates a card verification and records that it happened.
 *
 * NEVER THROWS. A provider or service failure becomes a structured ERROR
 * result, so verification stays best-effort and can never block a worker
 * reaching site. Callers decide how to surface the outcome; nobody has to
 * remember to try/catch.
 *
 * EVERY ATTEMPT IS LOGGED, including failures. "The card was never checked" and
 * "the check failed" are different facts about a competency record, and months
 * later nobody can tell them apart from the worker row alone — it holds only
 * the latest outcome.
 */

/** Last four characters only. The audit needs which card, not the credential. */
export function maskCardNumber(raw: string): string {
  const s = (raw ?? '').trim();
  if (s.length === 0) return '(none)';
  if (s.length <= 4) return `••••${s}`;
  return `••••${s.slice(-4)}`;
}

async function log(entry: {
  workerId?: string | null;
  cardNumber: string;
  scheme?: string | null;
  provider: string;
  status: string;
  verified: boolean;
  errorReason?: string | null;
  durationMs: number;
}): Promise<void> {
  // Logging must never break a verification. A failure to record is worth
  // knowing about but is not a reason to fail a worker's check-in.
  try {
    await prisma.cscsVerificationLog.create({
      data: {
        workerId: entry.workerId ?? null,
        cardNumberMasked: maskCardNumber(entry.cardNumber),
        scheme: entry.scheme ?? null,
        provider: entry.provider,
        status: entry.status,
        verified: entry.verified,
        errorReason: entry.errorReason?.slice(0, 500) ?? null,
        durationMs: entry.durationMs,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[CSCS Smart Check] audit log write failed', e);
  }
}

export async function verifyCscsCard(
  input: CscsVerifyInput & { workerId?: string | null },
): Promise<CscsVerificationResult> {
  const startedAt = Date.now();
  const config = await getCscsRuntimeConfig();

  // The master switch. Distinct from a provider that is configured but failing:
  // this says no check was attempted, which is what UNVERIFIED means.
  if (!config.verificationEnabled) {
    const result: CscsVerificationResult = {
      status: 'UNVERIFIED',
      verified: false,
      scheme: input.scheme ?? null,
      providerName: config.providerId,
      checkedAt: new Date(),
      message:
        'Card verification is currently switched off. Your details have been saved.',
    };
    await log({
      workerId: input.workerId,
      cardNumber: input.cardNumber,
      scheme: input.scheme,
      provider: config.providerId,
      status: result.status,
      verified: false,
      errorReason: 'verification disabled',
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  const provider = await resolveCscsProvider();

  try {
    const result = await provider.verifyCard(input);
    await log({
      workerId: input.workerId,
      cardNumber: input.cardNumber,
      scheme: result.scheme ?? input.scheme,
      provider: provider.name,
      status: result.status,
      verified: result.verified,
      errorReason: result.status === 'ERROR' ? result.message : null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Unknown verification error.';
    // eslint-disable-next-line no-console
    console.error('[CSCS Smart Check] verification failed:', error);

    const result: CscsVerificationResult = {
      status: 'ERROR',
      verified: false,
      scheme: input.scheme ?? null,
      providerName: provider.name,
      checkedAt: new Date(),
      message: messageForStatus('ERROR', null),
    };
    await log({
      workerId: input.workerId,
      cardNumber: input.cardNumber,
      scheme: input.scheme,
      provider: provider.name,
      status: 'ERROR',
      verified: false,
      // The provider's own message, which is written to never carry a
      // credential or an endpoint. Kept out of `result.message`, which a worker
      // sees.
      errorReason: reason,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }
}

/** Recent verification attempts for a worker — the admin-facing audit view. */
export async function listCscsVerifications(workerId: string, take = 20) {
  return prisma.cscsVerificationLog.findMany({
    where: { workerId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      cardNumberMasked: true,
      scheme: true,
      provider: true,
      status: true,
      verified: true,
      errorReason: true,
      durationMs: true,
      createdAt: true,
    },
  });
}
