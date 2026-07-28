import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';
import { evaluateGate } from '@/services/knowledgeChecks/attemptService';
import {
  evaluateCheckInGate,
  computeCheckOutLocation,
  type LocationFix,
} from '@/services/geo/geoValidationService';
import {
  buildInductionSteps,
  isStepComplete,
  type FlowItem,
  type InductionAnswers,
} from '@/services/checklists/inductionFlow';
import {
  getInductionSignatureRequired,
  buildSignatureRecord,
  type SignatureInput,
  type SignatureRecord,
} from '@/services/inductionSignature/signatureService';

/**
 * Check-in (Submission) operations.
 *
 * The induction wizard enforces required items client-side, but the server
 * NEVER trusts that: createCheckIn re-validates the submitted answers against the
 * site's current checklist before recording a COMPLIANT check-in. The named
 * gate booleans on Submission are best-effort summaries mirrored out of the
 * answers for easy reporting (site rules, RAMS and the safe-working agreement
 * are all required acknowledgements, so they are summarised together).
 */

/** A short, human-friendly check-in reference derived from the submission id. */
export function checkInReference(id: string): string {
  return `SC-${id.slice(-6).toUpperCase()}`;
}

function deriveGates(items: FlowItem[], answers: InductionAnswers) {
  const required = items.filter((i) => i.required);
  const ppe = required.filter((i) => i.type === 'PPE_CONFIRM');
  const acks = required.filter((i) => i.type === 'ACKNOWLEDGEMENT');

  const ppeConfirmed =
    ppe.length === 0 || ppe.every((i) => answers[i.id] === true);
  const acksDone =
    acks.length === 0 || acks.every((i) => answers[i.id] === true);

  return {
    ppeConfirmed,
    rulesAcknowledged: acksDone,
    safeWorkingAgreed: acksDone,
  };
}

export interface CreateCheckInInput {
  workerId: string;
  siteId: string;
  answers: InductionAnswers;
  gdprConsent: boolean;
  /** SC-007: the worker's location fix (or explicit "no fix"), if GPS applies. */
  location?: LocationFix | null;
  /** SC-011: the digital signature captured at Accept & Sign (if provided). */
  signature?: SignatureInput | null;
}

export type CreateCheckInResult =
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

export async function createCheckIn(
  input: CreateCheckInInput,
): Promise<CreateCheckInResult> {
  const site = await getActiveSiteWithChecklist(input.siteId);
  if (!site || !site.checklist) {
    return { ok: false, error: 'That site is no longer available.' };
  }

  const items: FlowItem[] = site.checklist.items.map((i) => ({
    id: i.id,
    label: i.label,
    helpText: i.helpText,
    type: i.type,
    required: i.required,
  }));

  // Re-validate the whole induction server-side.
  if (!input.gdprConsent) {
    return { ok: false, error: 'Data protection consent is required.' };
  }
  const steps = buildInductionSteps(items);
  const allComplete = steps.every((s) =>
    isStepComplete(s, input.answers, input.gdprConsent),
  );
  if (!allComplete) {
    return {
      ok: false,
      error:
        'Your induction is not complete. Please answer all required items.',
    };
  }

  // SC-005: an induction is only complete once its AI knowledge check is passed.
  // The gate is authoritative and server-side — it re-derives, never trusting the
  // client — and reports how the check was satisfied (passed vs skipped under the
  // site's SKIP_FLAGGED policy when no bank is available).
  const gate = await evaluateGate(input.workerId, input.siteId);
  if (!gate.satisfied) {
    return {
      ok: false,
      error:
        gate.reason === 'blocked'
          ? 'The site knowledge check isn’t available right now. Please try again shortly or speak to the site manager.'
          : 'Please complete the knowledge check before finishing your induction.',
    };
  }

  // SC-007: GPS location validation. Authoritative and server-side — it
  // recomputes distance from the site's coordinates, honours a manager override
  // and the site's GPS-unavailable policy, and returns the location fields to
  // record. A site without GPS validation passes through recording nothing.
  const geoFix: LocationFix = input.location ?? { unavailable: true };
  const geo = await evaluateCheckInGate(input.siteId, input.workerId, geoFix);
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

  // Idempotency: if already checked in (and not yet out) here, reuse it.
  const open = await prisma.submission.findFirst({
    where: {
      workerId: input.workerId,
      jobSiteId: input.siteId,
      checkedOutAt: null,
    },
    orderBy: { checkedInAt: 'desc' },
  });
  if (open) {
    return {
      ok: true,
      submissionId: open.id,
      reference: checkInReference(open.id),
      reused: true,
    };
  }

  // SC-011: digital induction acceptance. When the site requires a signature, one
  // must be provided; otherwise a supplied signature is still stored. Written once
  // here, on the fresh induction record — never mutated afterwards.
  let signatureRecord: SignatureRecord | undefined;
  const signatureRequired = await getInductionSignatureRequired(input.siteId);
  if (signatureRequired && !input.signature) {
    return {
      ok: false,
      error: 'Please sign the induction declaration to complete your check-in.',
    };
  }
  if (input.signature) {
    const built = await buildSignatureRecord(input.siteId, input.signature);
    if (!built.ok) return { ok: false, error: built.error };
    signatureRecord = built.record;
  }

  const gates = deriveGates(items, input.answers);
  const submission = await prisma.submission.create({
    data: {
      workerId: input.workerId,
      jobSiteId: input.siteId,
      checklistVersion: site.checklist.version,
      answers: input.answers,
      ...gates,
      gdprConsent: input.gdprConsent,
      status: SubmissionStatus.COMPLIANT,
      knowledgeCheckPassed: gate.attemptId !== null,
      knowledgeCheckSkipped: gate.skipped,
      ...geo.record,
      ...(signatureRecord ?? {}),
    },
  });

  // Consume a used override + link the passed attempt (for audit + reporting).
  if (geo.consumeOverrideId) {
    await prisma.checkInOverride.update({
      where: { id: geo.consumeOverrideId },
      data: { usedAt: new Date() },
    });
  }
  if (gate.attemptId) {
    await prisma.knowledgeCheckAttempt.update({
      where: { id: gate.attemptId },
      data: { submissionId: submission.id },
    });
  }

  return {
    ok: true,
    submissionId: submission.id,
    reference: checkInReference(submission.id),
    reused: false,
  };
}

/** Fetch a submission (with worker + site) for the confirmation screen,
 *  ensuring it belongs to the given worker. */
export async function getSubmissionForWorker(
  submissionId: string,
  workerId: string,
) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, workerId },
    include: { jobSite: true, worker: true },
  });
  return submission;
}

/**
 * Check a worker out of a site. Only affects their own open check-in. SC-007:
 * the check-out location is recorded for the attendance audit trail but NEVER
 * blocks — a worker can always leave site.
 */
export async function checkOut(
  submissionId: string,
  workerId: string,
  location?: LocationFix | null,
) {
  const target = await prisma.submission.findFirst({
    where: { id: submissionId, workerId, checkedOutAt: null },
    select: { id: true, jobSiteId: true },
  });
  if (!target) return false;

  const loc = await computeCheckOutLocation(target.jobSiteId, location ?? null);
  await prisma.submission.update({
    where: { id: target.id },
    data: { checkedOutAt: new Date(), ...loc },
  });
  return true;
}
