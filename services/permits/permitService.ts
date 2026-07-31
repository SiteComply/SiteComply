import { prisma } from '@/lib/prisma';
import { isPermitTypeAvailable } from '@/services/siteServices/siteServiceAvailability';
import type { Prisma, Permit, PermitActivity } from '@prisma/client';
import {
  WORK_ACTIVITY_MAX,
  WORK_LOCATION_MAX,
  ANSWER_TEXT_MAX,
  canWorkerCancel,
  type PermitStatusValue,
} from '@/services/permits/permitConstants';
import {
  areAnswersComplete,
  type PermitQuestion,
  type PermitAnswers,
  type AnsweredQuestion,
} from '@/services/permits/permitFlow';

/**
 * Permit to Work service (SC-009) — worker-facing create/read/cancel plus the
 * shared reference-code + activity-timeline helpers. An advisory register: a
 * permit never blocks a check-in. Access is by worker ownership (worker id) here;
 * the platform manager side lives in permitAdminService.
 */

const twoDigit = (n: number) => String(n).padStart(2, '0');

/** Build a human reference like "HW-260728-003" (prefix-YYMMDD-seq per prefix/day). */
async function nextReference(
  tx: Prisma.TransactionClient,
  prefix: string,
  now: Date,
): Promise<string> {
  const stamp = `${twoDigit(now.getFullYear() % 100)}${twoDigit(now.getMonth() + 1)}${twoDigit(now.getDate())}`;
  const base = `${prefix}-${stamp}-`;
  const countToday = await tx.permit.count({
    where: { reference: { startsWith: base } },
  });
  return `${base}${twoDigit(countToday + 1)}`;
}

export interface CreatePermitInput {
  workerId: string;
  workerName: string;
  siteId: string;
  permitTypeId: string;
  workActivity: string;
  workLocation?: string | null;
  proposedStart?: string | null;
  proposedFinish?: string | null;
  answers: PermitAnswers;
}

export type CreatePermitResult =
  | { ok: true; id: string; reference: string }
  | { ok: false; error: string };

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function createPermit(
  input: CreatePermitInput,
): Promise<CreatePermitResult> {
  const activity = input.workActivity?.trim() ?? '';
  if (activity.length < 3) {
    return { ok: false, error: 'Please describe the work activity.' };
  }

  const type = await prisma.permitType.findFirst({
    where: { id: input.permitTypeId, active: true },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  if (!type) return { ok: false, error: 'That permit type is not available.' };

  // SC-021 — SERVER-SIDE ENFORCEMENT, not just UI filtering. The picker already
  // hides types this site has switched off, but the id is postable regardless,
  // so availability is re-checked here where it actually counts. Same wording as
  // the global check above: a worker gets one honest answer either way.
  if (!(await isPermitTypeAvailable(input.siteId, type.id))) {
    return { ok: false, error: 'That permit type is not available.' };
  }

  const questions: PermitQuestion[] = type.questions.map((q) => ({
    id: q.id,
    label: q.label,
    helpText: q.helpText,
    type: q.type,
    required: q.required,
  }));
  if (!areAnswersComplete(questions, input.answers)) {
    return { ok: false, error: 'Please answer all required questions.' };
  }

  // Snapshot the answered questions onto the permit so the record is
  // self-contained and survives future catalogue changes.
  const answered: AnsweredQuestion[] = questions.map((q) => ({
    questionId: q.id,
    label: q.label,
    type: q.type,
    value:
      q.type === 'TEXT' || q.type === 'DATE'
        ? String(input.answers[q.id] ?? '').slice(0, ANSWER_TEXT_MAX)
        : input.answers[q.id],
  }));

  const now = new Date();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const reference = await nextReference(tx, type.referencePrefix, now);
      const permit = await tx.permit.create({
        data: {
          reference,
          jobSiteId: input.siteId,
          workerId: input.workerId,
          permitTypeId: type.id,
          permitTypeKey: type.key,
          permitTypeName: type.name,
          status: 'SUBMITTED',
          workActivity: activity.slice(0, WORK_ACTIVITY_MAX),
          workLocation:
            input.workLocation?.trim().slice(0, WORK_LOCATION_MAX) || null,
          proposedStart: parseDate(input.proposedStart),
          proposedFinish: parseDate(input.proposedFinish),
          answers: answered as unknown as Prisma.InputJsonValue,
          submittedByName: input.workerName,
          submittedAt: now,
        },
        select: { id: true, reference: true },
      });
      await tx.permitActivity.create({
        data: {
          permitId: permit.id,
          type: 'SUBMITTED',
          toValue: 'Awaiting approval',
          actorKind: 'worker',
          authorName: input.workerName,
        },
      });
      return permit;
    });
    return { ok: true, id: created.id, reference: created.reference };
  } catch {
    return {
      ok: false,
      error: 'We couldn’t submit your permit. Please try again.',
    };
  }
}

/** APPROVED permits past their validUntil read as EXPIRED (display-derived). */
export function effectiveStatus(p: {
  status: PermitStatusValue | string;
  validUntil: Date | null;
}): PermitStatusValue {
  if (
    p.status === 'APPROVED' &&
    p.validUntil &&
    p.validUntil.getTime() < Date.now()
  ) {
    return 'EXPIRED';
  }
  return p.status as PermitStatusValue;
}

export interface WorkerPermitListItem {
  id: string;
  reference: string;
  permitTypeName: string;
  iconKey: string;
  status: PermitStatusValue;
  submittedAt: Date;
  validUntil: Date | null;
  approvedByName: string | null;
}

/** All of a worker's permits, newest first, with derived status + type icon. */
export async function listWorkerPermits(
  workerId: string,
): Promise<WorkerPermitListItem[]> {
  const rows = await prisma.permit.findMany({
    where: { workerId },
    orderBy: { createdAt: 'desc' },
    include: { permitType: { select: { iconKey: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    permitTypeName: p.permitTypeName,
    iconKey: p.permitType.iconKey,
    status: effectiveStatus(p),
    submittedAt: p.submittedAt,
    validUntil: p.validUntil,
    approvedByName: p.approvedByName,
  }));
}

export interface PermitDetail {
  permit: Permit & { permitType: { iconKey: string } };
  effectiveStatus: PermitStatusValue;
  answers: AnsweredQuestion[];
  activities: PermitActivity[];
}

/** A worker's own permit (ownership-scoped), with answers + activity timeline. */
export async function getWorkerPermit(
  workerId: string,
  permitId: string,
): Promise<PermitDetail | null> {
  const p = await prisma.permit.findFirst({
    where: { id: permitId, workerId },
    include: {
      permitType: { select: { iconKey: true } },
      activities: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!p) return null;
  const { activities, ...permit } = p;
  return {
    permit,
    effectiveStatus: effectiveStatus(p),
    answers: (p.answers as unknown as AnsweredQuestion[]) ?? [],
    activities,
  };
}

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelWorkerPermit(
  workerId: string,
  workerName: string,
  permitId: string,
): Promise<CancelResult> {
  const p = await prisma.permit.findFirst({
    where: { id: permitId, workerId },
    select: { id: true, status: true },
  });
  if (!p) return { ok: false, error: 'Permit not found.' };
  if (!canWorkerCancel(p.status)) {
    return { ok: false, error: 'This permit can no longer be cancelled.' };
  }
  await prisma.$transaction([
    prisma.permit.update({
      where: { id: p.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    }),
    prisma.permitActivity.create({
      data: {
        permitId: p.id,
        type: 'CANCELLED',
        fromValue: p.status,
        toValue: 'Cancelled',
        actorKind: 'worker',
        authorName: workerName,
      },
    }),
  ]);
  return { ok: true };
}

/** Count of a worker's active permits at a site (dashboard metric). */
export async function countActiveWorkerPermits(
  siteId: string,
  workerId: string,
): Promise<number> {
  return prisma.permit.count({
    where: {
      jobSiteId: siteId,
      workerId,
      status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
    },
  });
}
