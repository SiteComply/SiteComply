import { AccessRequirement } from '@prisma/client';
import { prisma } from '@/lib/prisma';
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
      'The worker must have a CSCS card verified in SiteComply before they can check in.',
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
      'The worker must have passed this site’s knowledge check. Never blocks a first induction — they have not had the chance yet.',
    blocksFirstTime: false,
  },
  {
    requirement: 'INDUCTION_VALID',
    label: 'Induction still valid',
    description:
      'The worker’s induction for this site must still be within its validity period. Never blocks a first induction.',
    blocksFirstTime: false,
  },
  {
    requirement: 'SIGNATURE_ON_FILE',
    label: 'Signed induction declaration',
    description:
      'The worker must have signed the induction declaration for this site. Never blocks a first induction.',
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
export async function evaluateRequirements(
  workerId: string,
  siteId: string,
): Promise<UnmetRequirement[]> {
  const enabled = await prisma.siteAccessRequirement.findMany({
    where: { jobSiteId: siteId, enabled: true },
    select: { requirement: true },
  });
  if (enabled.length === 0) return [];

  const [worker, priorHere] = await Promise.all([
    prisma.worker.findUnique({
      where: { id: workerId },
      select: { cscsVerified: true, cscsExpiry: true, cscsCardNumber: true },
    }),
    prisma.submission.findFirst({
      where: { workerId, jobSiteId: siteId },
      select: { id: true },
      orderBy: { checkedInAt: 'desc' },
    }),
  ]);
  if (!worker) return [];
  const firstTime = priorHere === null;

  const unmet: UnmetRequirement[] = [];

  for (const { requirement } of enabled) {
    const meta = requirementMeta(requirement);
    // A requirement that cannot be satisfied before inducting here is skipped
    // for a first-timer — otherwise they can never start.
    if (firstTime && !meta.blocksFirstTime) continue;

    switch (requirement) {
      case 'CSCS_VERIFIED':
        if (!worker.cscsVerified) {
          unmet.push({
            requirement,
            label: meta.label,
            action: worker.cscsCardNumber
              ? 'Your CSCS card has not been verified yet. Ask your site manager to verify it in SiteComply.'
              : 'No CSCS card is recorded for you. Add your card details, then ask your site manager to verify it.',
          });
        }
        break;

      case 'CSCS_IN_DATE': {
        const exp = worker.cscsExpiry;
        if (!exp) {
          unmet.push({
            requirement,
            label: meta.label,
            action:
              'No expiry date is recorded for your CSCS card. Ask your site manager to add it.',
          });
        } else if (exp.getTime() < Date.now()) {
          unmet.push({
            requirement,
            label: meta.label,
            action: `Your CSCS card expired on ${formatDateUK(exp)}. Renew it and ask your site manager to update SiteComply.`,
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
