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
   * V2.6 identifies a card by SCHEME ID + SURNAME + REGISTRATION NUMBER, not by
   * a card number alone. Both of these are optional on the interface so nothing
   * that already calls verifyCard breaks, and the Smart Check provider refuses
   * clearly when they are absent rather than sending a request it knows is
   * incomplete — a malformed lookup would come back as "card not found" and read
   * to an operative at a site gate as a rejected card.
   *
   * Neither is captured at onboarding today. See docs/CSCS-CUTOVER.md.
   */
  /** Scheme identifier as issued by CSCS, e.g. "C4T". NOT the scheme name. */
  schemeId?: string | null;
  /** Family name as held by the scheme. */
  surname?: string | null;
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
  /**
   * For the audit log only, never shown to the operative: e.g. how many cards
   * the scheme returned and the standing of each.
   */
  note?: string;
}

export interface CscsProvider {
  readonly name: string;
  verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult>;
}

/**
 * The worker's details are incomplete, so no lookup was attempted.
 *
 * DISTINCT FROM A FAILED CHECK, and the distinction reaches an operative: "the
 * service could not complete this check" blames CSCS for something we never
 * asked them, and leaves the worker with nothing to do about it. A separate type
 * rather than a string to match on - reading prose to decide what happened is
 * how the sign-in classifier spent a day blaming the network.
 */
export class CscsDetailsMissingError extends Error {
  constructor(
    message: string,
    /** Which parts are absent, in words an operative would recognise. */
    readonly missing: string[],
  ) {
    super(message);
    this.name = 'CscsDetailsMissingError';
  }
}

/** Thrown when a Smart Check cannot be completed, to be handled gracefully upstream. */
export class CscsVerifyError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    /**
     * Whether trying again could plausibly succeed — a timeout, a 429, a 5xx.
     * False for a refusal that will repeat, such as rejected credentials.
     * Added for V2.6 authentication, where "we could not sign in" and "the card
     * was rejected" need to be told apart; without it they looked identical and
     * sent you hunting for the wrong problem.
     */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'CscsVerifyError';
  }
}
