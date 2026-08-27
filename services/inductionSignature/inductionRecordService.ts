import { prisma } from '@/lib/prisma';

/**
 * Worker-facing signed induction records (SC-011). Read-only, scoped to one
 * worker (their own inductions). Lists FULL inductions (not express reuses) so
 * the Inductions history shows the times the worker actually inducted + signed.
 */

/**
 * The knowledge-check result for an induction record.
 *
 * TWO DISTINCT FACTS, kept apart on purpose. The check is FORMATIVE: an attempt
 * only reaches PASSED once every sampled question has been answered correctly
 * (completeAttempt re-checks that from stored state), so the outcome of any
 * completed attempt is a pass at the full question count.
 *
 * `firstTry*` is a separate quality measure — how many were right without a
 * second go. It was previously the ONLY thing surfaced, and unlabelled, so a
 * record that necessarily passed displayed as "33% (1/3)". Both are returned
 * now, and the caller is expected to lead with the outcome.
 *
 * Derived entirely from stored values; nothing here changes what is recorded.
 */
export interface KnowledgeCheckResult {
  /** True once every question was answered correctly — the pass gate itself. */
  passed: boolean;
  /** Questions in the check. On a pass, this is also the number answered right. */
  total: number;
}

function kcResult(
  attempt: {
    status: string;
    questionCount: number;
  } | null,
): KnowledgeCheckResult | null {
  if (!attempt || attempt.questionCount === 0) return null;
  return {
    // Read from the attempt's own state rather than assumed from its existence:
    // an IN_PROGRESS attempt must never render as a pass.
    passed: attempt.status === 'PASSED',
    total: attempt.questionCount,
  };
}

export interface InductionListItem {
  submissionId: string;
  siteName: string;
  checklistVersion: number;
  completedAt: Date;
  signed: boolean;
  knowledgeCheckPassed: boolean;
}

/** A worker's full inductions (newest first) for the Inductions history. */
export async function listWorkerInductions(
  workerId: string,
): Promise<InductionListItem[]> {
  const rows = await prisma.submission.findMany({
    where: { workerId, inductionReused: false },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      checklistVersion: true,
      checkedInAt: true,
      declarationAccepted: true,
      knowledgeCheckPassed: true,
      jobSite: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    submissionId: r.id,
    siteName: r.jobSite.name,
    checklistVersion: r.checklistVersion,
    completedAt: r.checkedInAt,
    signed: r.declarationAccepted,
    knowledgeCheckPassed: r.knowledgeCheckPassed,
  }));
}

export interface InductionRecord {
  submissionId: string;
  workerName: string;
  siteName: string;
  siteAddress: string;
  checklistVersion: number;
  completedAt: Date;
  knowledgeCheck: KnowledgeCheckResult | null;
  knowledgeCheckPassed: boolean;
  knowledgeCheckSkipped: boolean;
  // Signature / declaration (SC-011).
  signed: boolean;
  declarationText: string | null;
  signedName: string | null;
  signatureType: 'DRAWN' | 'TYPED' | null;
  hasSignatureImage: boolean;
  signedAt: Date | null;
}

/** One of a worker's own induction records (ownership-scoped). */
export async function getWorkerInductionRecord(
  workerId: string,
  submissionId: string,
): Promise<InductionRecord | null> {
  const s = await prisma.submission.findFirst({
    where: { id: submissionId, workerId },
    select: {
      id: true,
      checklistVersion: true,
      checkedInAt: true,
      declarationAccepted: true,
      declarationText: true,
      signedName: true,
      signatureType: true,
      signatureBlobPath: true,
      signedAt: true,
      knowledgeCheckPassed: true,
      knowledgeCheckSkipped: true,
      worker: { select: { fullName: true } },
      jobSite: {
        select: {
          name: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          postcode: true,
        },
      },
      knowledgeCheckAttempt: {
        select: {
          status: true,
          questionCount: true,
        },
      },
    },
  });
  if (!s) return null;
  const address = [
    s.jobSite.addressLine1,
    s.jobSite.addressLine2,
    s.jobSite.town,
    s.jobSite.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    submissionId: s.id,
    workerName: s.worker.fullName,
    siteName: s.jobSite.name,
    siteAddress: address,
    checklistVersion: s.checklistVersion,
    completedAt: s.checkedInAt,
    knowledgeCheck: kcResult(s.knowledgeCheckAttempt),
    knowledgeCheckPassed: s.knowledgeCheckPassed,
    knowledgeCheckSkipped: s.knowledgeCheckSkipped,
    signed: s.declarationAccepted,
    declarationText: s.declarationText,
    signedName: s.signedName,
    signatureType: s.signatureType,
    hasSignatureImage: Boolean(s.signatureBlobPath),
    signedAt: s.signedAt,
  };
}

/** The signature blob path for a worker's own induction (for the download route). */
export async function getSignatureBlobForWorker(
  workerId: string,
  submissionId: string,
): Promise<string | null> {
  const s = await prisma.submission.findFirst({
    where: { id: submissionId, workerId },
    select: { signatureBlobPath: true },
  });
  return s?.signatureBlobPath ?? null;
}
