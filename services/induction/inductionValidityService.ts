import { SubmissionStatus, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkInReference } from '@/services/submissions/submissionService';
import { canWorkerCheckIn } from '@/services/workerAccess/workerAssignmentService';
import {
  evaluateCheckInGate,
  type LocationFix,
} from '@/services/geo/geoValidationService';

/**
 * Induction validity & re-induction (SC-006).
 *
 * A site can define how long a completed induction stays valid
 * (`SiteInductionConfig.inductionValidityDays`). While a worker's last full
 * induction for that site is still valid, they check in without re-inducting —
 * an "express" check-in that reuses the earlier induction. When it expires (by
 * time) or a manager invalidates previous inductions
 * (`inductionsInvalidatedAt`), the worker must complete the latest induction
 * (including the SC-005 knowledge check) again.
 *
 * With no validity configured (`inductionValidityDays` null) the feature is off
 * for that site — every check-in requires a full induction, exactly as before —
 * so SC-006 ships dark.
 *
 * Validity is always re-derived server-side; nothing here trusts the client.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type InductionValidity =
  | { enabled: false } //                         no validity window: induct every time
  | { enabled: true; state: 'none' } //           no prior full induction → must induct
  | {
      enabled: true;
      state: 'valid';
      completedAt: Date;
      expiresAt: Date;
      sourceSubmissionId: string;
    }
  | {
      enabled: true;
      state: 'expired';
      completedAt: Date;
      expiresAt: Date;
      reason: 'time' | 'invalidated';
      sourceSubmissionId: string;
    };

/** The most recent FULL compliant induction the worker completed for a site. */
async function lastFullInduction(workerId: string, siteId: string) {
  return prisma.submission.findFirst({
    where: {
      workerId,
      jobSiteId: siteId,
      status: SubmissionStatus.COMPLIANT,
      inductionReused: false,
    },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      checkedInAt: true,
      checklistVersion: true,
      answers: true,
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      knowledgeCheckPassed: true,
      // SC-011: carried forward so an express check-in inherits the signed
      // induction without the worker re-signing.
      declarationAccepted: true,
      declarationText: true,
      signedName: true,
      signatureType: true,
      signatureBlobPath: true,
      signedAt: true,
    },
  });
}

/**
 * Whether the worker holds a valid induction for the site, and the completion /
 * expiry dates driving the worker-facing message.
 */
export async function getInductionValidity(
  workerId: string,
  siteId: string,
): Promise<InductionValidity> {
  const config = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
    select: { inductionValidityDays: true, inductionsInvalidatedAt: true },
  });
  const validityDays = config?.inductionValidityDays ?? null;
  if (validityDays == null) return { enabled: false };

  const last = await lastFullInduction(workerId, siteId);
  if (!last) return { enabled: true, state: 'none' };

  const completedAt = last.checkedInAt;
  const expiresAt = new Date(completedAt.getTime() + validityDays * DAY_MS);
  const now = Date.now();

  // Invalidated: the last induction was completed at/before the manager cutoff.
  const invalidatedAt = config?.inductionsInvalidatedAt ?? null;
  if (invalidatedAt && completedAt.getTime() <= invalidatedAt.getTime()) {
    return {
      enabled: true,
      state: 'expired',
      reason: 'invalidated',
      completedAt,
      expiresAt,
      sourceSubmissionId: last.id,
    };
  }

  if (expiresAt.getTime() <= now) {
    return {
      enabled: true,
      state: 'expired',
      reason: 'time',
      completedAt,
      expiresAt,
      sourceSubmissionId: last.id,
    };
  }

  return {
    enabled: true,
    state: 'valid',
    completedAt,
    expiresAt,
    sourceSubmissionId: last.id,
  };
}

export type ExpressCheckInResult =
  | { ok: true; submissionId: string; reference: string; reused: boolean }
  | { ok: false; error: string }
  | {
      ok: false;
      error: string;
      gps: {
        reason: 'outside' | 'unavailable' | 'poor_accuracy';
        distanceM: number | null;
        radiusM: number;
      };
    };

/**
 * Record an attendance check-in by reusing the worker's still-valid induction
 * (SC-006) — no wizard, no new knowledge check. Re-validates the site is active
 * AND that a valid induction genuinely exists (never trusting the caller), then
 * carries forward the prior induction's answers, compliance gates, GDPR consent
 * and knowledge-check result onto a new attendance Submission linked to the
 * source. Idempotent with an existing open check-in, mirroring createCheckIn.
 */
export async function expressCheckIn(
  workerId: string,
  siteId: string,
  location?: LocationFix | null,
): Promise<ExpressCheckInResult> {
  const site = await prisma.jobSite.findFirst({
    where: { id: siteId, status: SiteStatus.ACTIVE },
    select: { id: true },
  });
  if (!site) return { ok: false, error: 'That site is no longer available.' };

  // SC-023 — express check-in is a SECOND write path that does not go through
  // createCheckIn, so it needs the access check in its own right. Enforcing
  // only in createCheckIn would let a returning worker with a valid induction
  // walk straight past the assignment requirement — precisely the kind of
  // second door that makes access control fail in practice.
  const access = await canWorkerCheckIn(workerId, siteId);
  if (!access.allowed) return { ok: false, error: access.reason };

  const validity = await getInductionValidity(workerId, siteId);
  if (!(validity.enabled && validity.state === 'valid')) {
    return {
      ok: false,
      error: 'Please complete the site induction before checking in.',
    };
  }

  // SC-007: an express check-in is still a check-in action — GPS-validate it.
  const geo = await evaluateCheckInGate(
    siteId,
    workerId,
    location ?? { unavailable: true },
  );
  if (!geo.allow) {
    return {
      ok: false,
      error:
        geo.reason === 'outside'
          ? 'You’re outside this site’s check-in area. Move closer to the site entrance, or ask your site manager to authorise an off-site check-in.'
          : geo.reason === 'poor_accuracy'
            ? 'We couldn’t get an accurate location. Move to an open area and try again.'
            : 'We couldn’t confirm your location. Please enable location access and try again, or ask your site manager to authorise a check-in.',
      gps: {
        reason: geo.reason,
        distanceM: geo.distanceM,
        radiusM: geo.radiusM,
      },
    };
  }

  // Idempotency: reuse an existing open check-in here.
  const open = await prisma.submission.findFirst({
    where: { workerId, jobSiteId: siteId, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: { id: true },
  });
  if (open) {
    return {
      ok: true,
      submissionId: open.id,
      reference: checkInReference(open.id),
      reused: true,
    };
  }

  const source = await lastFullInduction(workerId, siteId);
  if (!source) {
    return {
      ok: false,
      error: 'Please complete the site induction before checking in.',
    };
  }

  const submission = await prisma.submission.create({
    data: {
      workerId,
      jobSiteId: siteId,
      checklistVersion: source.checklistVersion,
      answers: source.answers === null ? undefined : source.answers,
      ppeConfirmed: source.ppeConfirmed,
      rulesAcknowledged: source.rulesAcknowledged,
      safeWorkingAgreed: source.safeWorkingAgreed,
      gdprConsent: source.gdprConsent, // carry-forward consent (SC-006)
      status: SubmissionStatus.COMPLIANT,
      knowledgeCheckPassed: source.knowledgeCheckPassed,
      knowledgeCheckSkipped: false,
      inductionReused: true,
      inductionSourceSubmissionId: source.id,
      // SC-011: inherit the source induction's signed acceptance (no re-signing).
      declarationAccepted: source.declarationAccepted,
      declarationText: source.declarationText,
      signedName: source.signedName,
      signatureType: source.signatureType,
      signatureBlobPath: source.signatureBlobPath,
      signedAt: source.signedAt,
      ...geo.record,
    },
    select: { id: true },
  });

  if (geo.consumeOverrideId) {
    await prisma.checkInOverride.update({
      where: { id: geo.consumeOverrideId },
      data: { usedAt: new Date() },
    });
  }

  return {
    ok: true,
    submissionId: submission.id,
    reference: checkInReference(submission.id),
    reused: false,
  };
}
