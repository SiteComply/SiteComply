import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';
import {
  buildInductionSteps,
  isStepComplete,
  type FlowItem,
  type InductionAnswers,
} from '@/services/checklists/inductionFlow';

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
}

export type CreateCheckInResult =
  | { ok: true; submissionId: string; reference: string; reused: boolean }
  | { ok: false; error: string };

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
    },
  });

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

/** Check a worker out of a site. Only affects their own open check-in. */
export async function checkOut(submissionId: string, workerId: string) {
  const result = await prisma.submission.updateMany({
    where: { id: submissionId, workerId, checkedOutAt: null },
    data: { checkedOutAt: new Date() },
  });
  return result.count > 0;
}
