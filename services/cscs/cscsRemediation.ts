/**
 * SC-001 — asking an operative to put their card details right.
 *
 * A softer step than refusing them at a site gate: the app prompts, they fix it,
 * and nobody is standing outside unable to start work. It is also what PRODUCES
 * the data hard enforcement would need — a card cannot be verified until the
 * operative has supplied the surname and scheme to look it up by.
 *
 * ── BEHIND A FLAG ─────────────────────────────────────────────────────────
 *
 *     CSCS_REMEDIATION_ENABLED = "1"
 *
 * Off unless set to exactly "1", and removable without a deploy. Same shape as
 * the exempt allow-list, for the same reason: anything that changes what every
 * operative sees should be switchable off in a minute, not a release.
 */
import { isCscsExemptMobile } from './cscsExemptAccounts';
import { isSchemeNotListed } from '@/services/cscs/schemes';

/** Whether the remediation prompt is switched on at all. */
export function remediationIsEnabled(): boolean {
  return process.env.CSCS_REMEDIATION_ENABLED === '1';
}

export interface RemediationSubject {
  mobile?: string | null;
  cscsCardNumber?: string | null;
  /** SCHEME_NOT_LISTED when the operative said theirs is not on the list. */
  cscsSchemeId?: string | null;
  cscsVerificationStatus?: string | null;
}

/**
 * Whether this operative should be asked to review their card details.
 *
 * ── WHO IS NOT ASKED, AND WHY ─────────────────────────────────────────────
 *
 *   the exempt test account  it is routed to the mock and is UNVERIFIED for
 *                            ever by design; prompting it would be permanent
 *                            noise about a state that is intended.
 *   no card recorded         there is nothing to correct. An operative who
 *                            holds no CSCS card is not failing anything.
 *   VALID                    nothing to do.
 *   ERROR                    the check could not be COMPLETED - the service was
 *                            unreachable or answered in a way we could not read.
 *                            That is not something the operative can fix by
 *                            editing their details, and prompting them to try
 *                            would send them round a loop that only ends when
 *                            somebody else's server comes back.
 */
export function needsCscsRemediation(worker: RemediationSubject): boolean {
  if (!remediationIsEnabled()) return false;
  if (isCscsExemptMobile(worker.mobile)) return false;
  if (!worker.cscsCardNumber?.trim()) return false;
  /*
   * "MY SCHEME IS NOT LISTED" is not the operative's to fix. None of the
   * seventeen issued their card; prompting them to review their details would
   * loop on a question with no right answer, the same reason ERROR is not
   * prompted below. An operative who simply has not answered yet IS prompted -
   * that one they can fix - which is why the answer is stored rather than left
   * as an empty scheme.
   */
  if (isSchemeNotListed(worker.cscsSchemeId)) return false;

  switch ((worker.cscsVerificationStatus ?? '').toUpperCase()) {
    case 'REVOKED':
    case 'EXPIRED':
    case 'NOT_FOUND':
    case 'UNVERIFIED':
      return true;
    default:
      // VALID, ERROR, and anything we do not recognise. An unrecognised status
      // is not grounds for badgering someone about their card.
      return false;
  }
}

/**
 * What the prompt says, per status.
 *
 * Deliberately the SAME WORDS as the refusal at the gate
 * (accessRequirements.cscsRefusalAction), so an operative who sees both is told
 * one story. The heading differs because the situations differ: this one is an
 * interruption, that one is a refusal.
 */
export function remediationHeading(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'REVOKED':
      return 'Your CSCS card is recorded as withdrawn';
    case 'EXPIRED':
      return 'Your CSCS card is recorded as expired';
    case 'NOT_FOUND':
      return 'We could not find your CSCS card';
    default:
      return 'Your CSCS card has not been checked yet';
  }
}

/**
 * A key that changes when the STATUS changes.
 *
 * Dismissal is remembered per status, not per worker: someone who dismissed
 * "expired" must be asked again if the card later comes back "withdrawn". A
 * single flag would have let the first dismissal silence the second, which is
 * the more serious message.
 */
export function remediationDismissKey(
  workerId: string,
  status: string | null | undefined,
): string {
  return `sc.cscs.remediation.${workerId}.${(status ?? 'UNKNOWN').toUpperCase()}`;
}
