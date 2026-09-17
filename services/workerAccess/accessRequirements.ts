import { AccessRequirement } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isCscsExemptMobile } from '@/services/cscs/cscsExemptAccounts';
import { formatDateUK } from '@/lib/datetime';
import { getInductionValidity } from '@/services/induction/inductionValidityService';

/**
 * SC-023 Phase 3 — competency and induction requirements for site access.
 *
 * Each requirement carries its OWN remedy text, and an unmet check returns
 * every failure rather than the first. A worker turned away at a gate should
 * learn everything they need to fix in one trip; discovering a second problem
 * after solving the first is how a control becomes resented and worked around.
 *
 * THE FIRST-TIME RULE. Some requirements cannot logically be met before a
 * worker has ever inducted here: they have not taken the knowledge check, have
 * not signed anything, and have no induction to still be valid. Enforcing those
 * against a first-timer would deadlock them — the induction IS the check-in in
 * this product, so there is no earlier moment at which to satisfy them.
 *
 * CSCS is different, and deliberately so: a card is something a worker holds
 * BEFORE arriving, so being stopped at the gate without one is the correct
 * outcome rather than a trap. SC-012 shipped CSCS as advisory and explicitly
 * deferred enforcement; this is where that becomes real.
 */

export interface RequirementMeta {
  requirement: AccessRequirement;
  label: string;
  /** What a manager is switching on. */
  description: string;
  /**
   * Whether this can refuse someone who has never inducted at this site.
   * False for anything only obtainable BY inducting.
   */
  blocksFirstTime: boolean;
}

export const ACCESS_REQUIREMENTS: RequirementMeta[] = [
  {
    requirement: 'CSCS_VERIFIED',
    label: 'Verified CSCS card',
    description:
      'The operative must have a CSCS card verified in SiteComply before they can check in.',
    blocksFirstTime: true,
  },
  {
    requirement: 'CSCS_IN_DATE',
    label: 'CSCS card in date',
    description:
      'The verified card must have an expiry date that has not passed. A card with no expiry recorded does not satisfy this.',
    blocksFirstTime: true,
  },
  {
    requirement: 'KNOWLEDGE_CHECK_PASSED',
    label: 'Knowledge check passed',
    description:
      'The operative must have passed this site’s knowledge check. Never blocks a first induction — they have not had the chance yet.',
    blocksFirstTime: false,
  },
  {
    requirement: 'INDUCTION_VALID',
    label: 'Induction still valid',
    description:
      'The operative’s induction for this site must still be within its validity period. Never blocks a first induction.',
    blocksFirstTime: false,
  },
  {
    requirement: 'SIGNATURE_ON_FILE',
    label: 'Signed induction declaration',
    description:
      'The operative must have signed the induction declaration for this site. Never blocks a first induction.',
    blocksFirstTime: false,
  },
];

export function requirementMeta(r: AccessRequirement): RequirementMeta {
  return ACCESS_REQUIREMENTS.find((x) => x.requirement === r)!;
}

export interface UnmetRequirement {
  requirement: AccessRequirement;
  label: string;
  /** Exactly what this worker must do — specific, not generic. */
  action: string;
}

/**
 * Evaluate a site's enabled requirements against one worker.
 *
 * Returns EVERY unmet requirement. `firstTime` is judged per SITE: someone who
 * has inducted elsewhere is still new here, and the requirements that depend on
 * having inducted at THIS site must not fire against them.
 */
/**
 * What to tell an operative whose card did not pass, and what to do about it.
 *
 * ONE MESSAGE PER OUTCOME, because the right next step differs completely:
 * a revoked card is a conversation with the scheme, a not-found is usually a
 * typo, and an unreachable service is nobody's fault and will pass on a retry.
 * "Not verified" for all five sends most of them to the wrong person.
 */
export function cscsRefusalAction(
  status: string | null | undefined,
  hasCard: boolean,
): string {
  switch ((status ?? '').toUpperCase()) {
    case 'REVOKED':
      return 'Your CSCS card is recorded as withdrawn by the card scheme. Contact the scheme before working on site.';
    case 'EXPIRED':
      return 'Your CSCS card is recorded as expired. Renew it and update your details.';
    case 'NOT_FOUND':
      return 'No matching card was found. Check the card number, surname and scheme on your details, then try again.';
    case 'ERROR':
      return 'Your card could not be checked just now. Try again in a few minutes, or ask your site manager.';
    default:
      return hasCard
        ? 'Your CSCS card has not been verified yet. Open Your Details to confirm your surname and card scheme, then save.'
        : 'No CSCS card is recorded for you. Add your card details in Your Details.';
  }
}

export async function evaluateRequirements(
  workerId: string,
  siteId: string,
  /**
   * Evaluate as if exactly these requirements were enabled, ignoring what is
   * stored. Used by the "who would this block?" preview, which previously got
   * the same answer by switching the requirement ON in the database, measuring,
   * and switching it back — a write performed during a page RENDER. That wrote
   * to a completed project (crashing the roster with ProjectClosedError), raced
   * any concurrent check-in against a requirement nobody had chosen, and left
   * the requirement enabled for good if the process died mid-measurement.
   */
  enabledOverride?: readonly AccessRequirement[],
): Promise<UnmetRequirement[]> {
  const enabled =
    enabledOverride !== undefined
      ? enabledOverride.map((requirement) => ({ requirement }))
      : await prisma.siteAccessRequirement.findMany({
          where: { jobSiteId: siteId, enabled: true },
          select: { requirement: true },
        });
  if (enabled.length === 0) return [];

  const [worker, priorHere] = await Promise.all([
    prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        cscsVerified: true,
        cscsExpiry: true,
        cscsCardNumber: true,
        cscsVerificationStatus: true,
        // Only to honour the exempt allow-list. Nothing else reads it here.
        mobile: true,
      },
    }),
    prisma.submission.findFirst({
      where: { workerId, jobSiteId: siteId },
      select: { id: true },
      orderBy: { checkedInAt: 'desc' },
    }),
  ]);
  if (!worker) return [];

  /*
   * THE EXEMPT TEST ACCOUNT SKIPS CSCS ENFORCEMENT.
   *
   * The exemption routes that mobile to the mock, which is inert in production
   * and returns UNVERIFIED for ever. Enforcing CSCS against it would lock the
   * account out of every site the requirement is enabled on - the two
   * mechanisms in direct contradiction, one guaranteeing the account is never
   * verified and the other refusing anyone who is not.
   *
   * NARROW ON PURPOSE. Only the CSCS requirements are skipped. Induction, the
   * knowledge check and every other requirement still apply, because none is
   * affected by which provider the account is routed to. Same allow-list as
   * the provider resolver, read the same way.
   */
  const cscsExempt = isCscsExemptMobile(worker.mobile);
  const firstTime = priorHere === null;

  const unmet: UnmetRequirement[] = [];

  for (const { requirement } of enabled) {
    const meta = requirementMeta(requirement);
    // A requirement that cannot be satisfied before inducting here is skipped
    // for a first-timer — otherwise they can never start.
    if (firstTime && !meta.blocksFirstTime) continue;

    // Only the CSCS requirements are exempted; everything else still applies.
    if (
      cscsExempt &&
      (requirement === 'CSCS_VERIFIED' || requirement === 'CSCS_IN_DATE')
    ) {
      continue;
    }

    switch (requirement) {
      case 'CSCS_VERIFIED':
        /*
         * VALID, AND ONLY VALID. cscsVerified is already derived from
         * `status === 'VALID'` in both mappers, so the boolean IS the rule -
         * REVOKED, EXPIRED, NOT_FOUND, ERROR and UNVERIFIED are every one of
         * them false and every one of them refused.
         *
         * The STATUS is read here only to say WHICH of those it was. A worker
         * told "not verified" when their card is actually withdrawn goes looking
         * for an admin to press a button, and the button will not help them.
         */
        if (!worker.cscsVerified) {
          unmet.push({
            requirement,
            label: meta.label,
            action: cscsRefusalAction(
              worker.cscsVerificationStatus,
              Boolean(worker.cscsCardNumber),
            ),
          });
        }
        break;

      case 'CSCS_IN_DATE': {
        /*
         * THE SCHEME'S ANSWER OUTRANKS ANY DATE WE HOLD.
         *
         * V2.6 returns no expiry DATE at all - a card's standing is two booleans,
         * `expired` and `cancelled`, and a VALID result means the scheme told us
         * `expired: false`. So a verified card IS in date, by definition, and
         * asking for a date on top of that asks for something the contract
         * cannot supply.
         *
         * Reading cscsExpiry first was a real trap: Smart Check never writes it,
         * so it holds only what the operative typed. Someone could obtain a
         * perfect VALID from CSCS and still be refused for "no expiry date
         * recorded" - told to ask a site manager to add a date that no longer
         * comes from anywhere.
         *
         * The typed date is now a FALLBACK, used only where there is no verified
         * status to rely on. It is the operative's own guess, and better than
         * nothing when nothing is the alternative.
         */
        const status = (worker.cscsVerificationStatus ?? '').toUpperCase();
        const exp = worker.cscsExpiry;

        if (status === 'VALID') {
          // The scheme says the card is not expired. Nothing further to check.
          break;
        }

        if (status === 'EXPIRED') {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'Your CSCS card is recorded by the card scheme as expired. Renew it, then update your details so it can be checked again.',
          });
          break;
        }

        // No usable verified status. Fall back to whatever date we hold.
        if (!exp) {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'Your CSCS card has not been checked yet, and no expiry date is recorded. Open Your Details to confirm your surname and card scheme so it can be verified.',
          });
        } else if (exp.getTime() < Date.now()) {
          unmet.push({
            requirement,
            label: meta.label,
            action: `Your CSCS card expired on ${formatDateUK(exp)}. Renew it and update your details.`,
          });
        }
        break;
      }

      case 'KNOWLEDGE_CHECK_PASSED': {
        const passed = await prisma.submission.findFirst({
          where: { workerId, jobSiteId: siteId, knowledgeCheckPassed: true },
          select: { id: true },
        });
        if (!passed) {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'You have not passed this site’s knowledge check. Complete the induction again and pass the knowledge check.',
          });
        }
        break;
      }

      case 'INDUCTION_VALID': {
        const validity = await getInductionValidity(workerId, siteId);
        // `enabled: false` means the site sets no validity window and
        // re-inducts every time — there is no induction to have lapsed, so the
        // requirement is satisfied. Treating it as unmet would refuse every
        // worker on every site that re-inducts, which is the stricter setting.
        if (validity.enabled && validity.state !== 'valid') {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'Your induction for this site is no longer valid. Complete the site induction again.',
          });
        }
        break;
      }

      case 'SIGNATURE_ON_FILE': {
        const signed = await prisma.submission.findFirst({
          where: { workerId, jobSiteId: siteId, declarationAccepted: true },
          select: { id: true },
        });
        if (!signed) {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'You have not signed the induction declaration for this site. Complete the induction and sign the declaration.',
          });
        }
        break;
      }
    }
  }

  return unmet;
}

/**
 * The worker-facing refusal.
 *
 * Lists every unmet requirement with its action, so one refusal explains the
 * whole gap. Kept as a single string because it is delivered through the same
 * narrow error channel as every other check-in refusal.
 */
export function formatUnmetMessage(
  siteName: string,
  unmet: UnmetRequirement[],
): string {
  if (unmet.length === 0) return '';
  const lines = unmet.map((u) => `• ${u.label}: ${u.action}`);
  return (
    `You cannot check in to ${siteName} yet — ${unmet.length} requirement${unmet.length === 1 ? '' : 's'} not met:\n` +
    lines.join('\n')
  );
}
