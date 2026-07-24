import { CscsCardType } from '@prisma/client';

/**
 * CSCS Smart Check provider abstraction (SC-001).
 *
 * The worker identity/profile flow talks only to this interface, so the
 * underlying verification gateway — the official CSCS Smart Check service in
 * production; a deterministic console mock for local development — can be swapped
 * via the CSCS_PROVIDER env var with no change to the check-in logic.
 *
 * See: https://www.cscssmartcheck.co.uk (CSCS Group). The Smart Check service
 * verifies cards across the CSCS Alliance partner schemes (CSCS, ECS, etc.).
 */

/** Outcome of a Smart Check lookup. */
export type CscsVerificationStatus =
  | 'VALID' //       Card found and in date
  | 'EXPIRED' //     Card found but past its expiry date
  | 'REVOKED' //     Card found but withdrawn/revoked
  | 'NOT_FOUND' //   No matching card on the scheme
  | 'ERROR' //       The check could not be completed (network/service error)
  | 'UNVERIFIED'; // No usable card number supplied — nothing checked

/** A single competency/qualification held on the card, per Smart Check. */
export interface CscsQualification {
  title: string;
  detail?: string;
}

export interface CscsVerifyInput {
  /** Card number as entered — numerical or alphanumeric. */
  cardNumber: string;
  /** Scheme hint where known (e.g. "ECS", "CSCS"). Optional. */
  scheme?: string | null;
  /**
   * Details the worker typed, used by the mock to produce believable output and
   * ignored by the real Smart Check provider (which returns the scheme's own
   * record of truth).
   */
  holderName?: string | null;
  cardTypeHint?: CscsCardType | null;
  expiryHint?: Date | null;
}

export interface CscsVerificationResult {
  status: CscsVerificationStatus;
  /** True only when the card is found AND currently in date (status VALID). */
  verified: boolean;
  /** Verified scheme name, e.g. "ECS" or "CSCS". */
  scheme?: string | null;
  /** Verified card grade, mapped to our enum where recognised. */
  cardType?: CscsCardType | null;
  /** Name held on the card. */
  holderName?: string | null;
  /** Verified expiry date (date-only, UTC midnight). */
  expiry?: Date | null;
  /** Competency records to populate against the worker. */
  qualifications?: CscsQualification[];
  /** Provider that produced this result. */
  providerName: string;
  /** When the check ran. */
  checkedAt: Date;
  /** Short human-readable summary, safe to show the worker. */
  message: string;
}

export interface CscsProvider {
  readonly name: string;
  verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult>;
}

/** Thrown when a Smart Check cannot be completed, to be handled gracefully upstream. */
export class CscsVerifyError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CscsVerifyError';
  }
}
