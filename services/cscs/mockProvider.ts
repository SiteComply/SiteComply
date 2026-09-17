import { CscsCardType } from '@prisma/client';
import { normaliseCscsCardNumber } from '@/lib/cscs';
import {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsQualification,
} from './CscsProvider';

/**
 * Development CSCS provider. Instead of calling the real Smart Check service it
 * returns a deterministic result derived from the supplied card number, so the
 * SC-001 verification flow is fully exercisable locally without a Smart Check
 * partnership.
 *
 * ── IT MUST NOT FABRICATE IN PRODUCTION (CSCS cutover, Phase 1) ─────────────
 *
 * The comment here used to read "Never selected in production". It was not true:
 * `CscsConfig.activeProvider` defaults to "mock", so production ran this, marked
 * real people's cards `cscsVerified = true`, invented a scheme, invented an
 * expiry of today + 3 years and invented competency records — then told the
 * operative "Card verified against the CSCS Smart Check service."
 *
 * Nothing had been verified. A competency gate satisfied by an invented number
 * is worse than no gate, because it produces a record asserting a check was
 * done.
 *
 * So the claim is now true BY CONSTRUCTION rather than by intention: in
 * production this returns UNVERIFIED and writes nothing derived. Locally it
 * still behaves fully, so the journey stays testable — and even there it never
 * claims the result came from CSCS.
 *
 * Deterministic rules (for predictable testing):
 *   - empty / unusable number         → UNVERIFIED
 *   - number contains "0000" / "FAIL" → NOT_FOUND (simulate an unknown card)
 *   - number contains "REVOKED"       → REVOKED
 *   - an expiry hint in the past       → EXPIRED
 *   - otherwise                        → VALID (echoes the typed grade/expiry and
 *                                        adds representative competency records)
 */
/**
 * WHY the mock was chosen, which decides what the operative is told.
 *
 * The two reasons look identical to the provider but mean opposite things to
 * the person reading the screen:
 *
 *   'not-configured' — this tenant has no verification provider set up. "Not
 *                      switched on yet" is the honest explanation.
 *   'exempt-account' — verification IS configured and working; THIS account is
 *                      on the test allow-list and deliberately skips it.
 *
 * Telling an exempt tester that "automatic CSCS checking is not switched on
 * yet" reads as a broken or misconfigured integration, and prompted exactly
 * that report. The mock cannot infer which case it is in, so the caller that
 * made the choice says so.
 */
export type MockReason = 'not-configured' | 'exempt-account';

export class MockCscsProvider implements CscsProvider {
  readonly name = 'mock';

  /** Defaults to 'not-configured' — the safe reading for any caller that has
   *  not deliberately routed an exempt account here. */
  constructor(private readonly reason: MockReason = 'not-configured') {}

  async verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult> {
    const checkedAt = new Date();
    const number = normaliseCscsCardNumber(input.cardNumber ?? '');

    // Deliberately no env escape hatch. An override for "just this once" is how
    // a mock ends up verifying cards in production again.
    if (mockIsInert()) {
      return {
        providerName: this.name,
        checkedAt,
        scheme: null,
        // UNCHANGED, and deliberately so: an exempt account is still UNVERIFIED
        // and still `verified: false`. Only the explanation differs. Nothing
        // here may ever let the allow-list manufacture a pass.
        status: 'UNVERIFIED',
        verified: false,
        message:
          this.reason === 'exempt-account'
            ? 'This test account is exempt from CSCS verification and can continue without a card check.'
            : 'Card details recorded. Automatic CSCS checking is not switched on yet, so this card has not been verified.',
      };
    }

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
        message: 'Test check: no matching card. Not a real CSCS verification.',
      };
    }

    if (/REVOKED/.test(number)) {
      return {
        ...base,
        status: 'REVOKED',
        verified: false,
        holderName: input.holderName ?? null,
        message: 'Test check: revoked. Not a real CSCS verification.',
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
        message: 'Test check: expired. Not a real CSCS verification.',
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
      message: 'Test check passed. Not a real CSCS verification.',
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

/**
 * True when the mock must not produce a verification result.
 *
 * Exported so the decision is one greppable predicate rather than an
 * `process.env` check buried in a branch, and so a test can assert the rule
 * rather than the environment.
 */
export function mockIsInert(): boolean {
  return process.env.NODE_ENV === 'production';
}
