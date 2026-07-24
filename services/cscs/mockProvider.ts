import { CscsCardType } from '@prisma/client';
import { normaliseCscsCardNumber } from '@/lib/cscs';
import {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsQualification,
} from './CscsProvider';

/**
 * Development-only CSCS Smart Check provider. Instead of calling the real Smart
 * Check service it returns a deterministic result derived from the supplied card
 * number, so the SC-001 verification flow is fully exercisable locally without a
 * Smart Check partnership. Never selected in production.
 *
 * Deterministic rules (for predictable testing):
 *   - empty / unusable number         → UNVERIFIED
 *   - number contains "0000" / "FAIL" → NOT_FOUND (simulate an unknown card)
 *   - number contains "REVOKED"       → REVOKED
 *   - an expiry hint in the past       → EXPIRED
 *   - otherwise                        → VALID (echoes the typed grade/expiry and
 *                                        adds representative competency records)
 */
export class MockCscsProvider implements CscsProvider {
  readonly name = 'mock';

  async verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult> {
    const checkedAt = new Date();
    const number = normaliseCscsCardNumber(input.cardNumber ?? '');

    const base = {
      providerName: this.name,
      checkedAt,
      scheme: deriveScheme(number, input.scheme),
    };

    if (!number) {
      return {
        ...base,
        status: 'UNVERIFIED',
        verified: false,
        scheme: null,
        message: 'No card number supplied.',
      };
    }

    if (/0000|FAIL/.test(number)) {
      return {
        ...base,
        status: 'NOT_FOUND',
        verified: false,
        message: 'No matching card found on the CSCS Smart Check service.',
      };
    }

    if (/REVOKED/.test(number)) {
      return {
        ...base,
        status: 'REVOKED',
        verified: false,
        holderName: input.holderName ?? null,
        message: 'This card has been revoked by the issuing scheme.',
      };
    }

    const cardType = input.cardTypeHint ?? CscsCardType.BLUE_SKILLED;
    const expiry = input.expiryHint ?? defaultExpiry(checkedAt);

    if (expiry.getTime() < startOfUtcDay(checkedAt)) {
      return {
        ...base,
        status: 'EXPIRED',
        verified: false,
        cardType,
        expiry,
        holderName: input.holderName ?? null,
        message: 'This card was found but has expired.',
      };
    }

    return {
      ...base,
      status: 'VALID',
      verified: true,
      cardType,
      expiry,
      holderName: input.holderName ?? null,
      qualifications: mockQualifications(cardType),
      message: 'Card verified against the CSCS Smart Check service.',
    };
  }
}

function deriveScheme(number: string, hint?: string | null): string {
  if (hint && hint.trim()) return hint.trim().toUpperCase();
  // Cards that carry letters are treated as a partner scheme (e.g. ECS);
  // purely numerical cards default to the core CSCS scheme.
  return /[A-Z]/.test(number) ? 'ECS' : 'CSCS';
}

function defaultExpiry(from: Date): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear() + 3, from.getUTCMonth(), from.getUTCDate()),
  );
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function mockQualifications(cardType: CscsCardType): CscsQualification[] {
  const grade: Record<CscsCardType, string> = {
    GREEN_LABOURER: 'Labourer',
    RED_TRAINEE: 'Trainee / Experienced Worker',
    BLUE_SKILLED: 'Skilled Worker',
    GOLD_SUPERVISORY: 'Advanced Craft / Supervisory',
    BLACK_MANAGER: 'Manager',
    WHITE_PROFESSIONAL: 'Professionally Qualified Person',
  };
  return [
    {
      title: 'Health, Safety & Environment Test',
      detail: 'Passed (within validity)',
    },
    { title: `${grade[cardType]} competency`, detail: 'Confirmed by scheme' },
  ];
}
