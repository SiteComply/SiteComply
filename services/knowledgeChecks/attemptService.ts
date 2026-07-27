import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEffectiveConfig } from '@/services/knowledgeChecks/knowledgeCheckConfigService';
import {
  ensureReadyBank,
  loadBankInduction,
} from '@/services/knowledgeChecks/questionBankService';

/**
 * Worker knowledge-check attempts (SC-005).
 *
 * The check is formative and gates the induction: a worker must finish every
 * sampled question correctly (they may correct wrong answers — there is no
 * fail-out), and only then is a compliant check-in recorded. Grading is entirely
 * server-side: the correct option is never sent to the client, so a pass cannot
 * be forged.
 *
 * When a site has checks enabled but no usable bank exists, the site's
 * unavailable policy applies — SKIP_FLAGGED (default) lets the worker through and
 * records the skip; BLOCK stops the check-in.
 */

export interface ClientQuestion {
  id: string;
  prompt: string;
  category: string;
  sourceRef: string | null;
  options: { id: string; text: string }[];
}

export interface ReviewContent {
  inductionContent: string;
  fireAssemblyPoint: string | null;
  firstAiderName: string | null;
  firstAiderLocation: string | null;
  firstAiderNumber: string | null;
  nearestHospital: string | null;
  emergencyNumber: string | null;
}

export type StartResult =
  | { state: 'not_required' } //          checks off, or skipped under SKIP_FLAGGED
  | { state: 'blocked'; message: string } // BLOCK policy + no bank available
  | {
      state: 'ready';
      attemptId: string;
      questions: ClientQuestion[];
      review: ReviewContent;
      answered: Record<string, boolean>; // questionId → already-correct (resume)
    };

interface StoredAnswer {
  selectedOptionId: string;
  tries: number;
  correct: boolean;
}
type AnswersMap = Record<string, StoredAnswer>;

interface StoredOption {
  id: string;
  text: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Stratified sample: spread the picks across categories, then top up, then shuffle. */
function sampleQuestions<T extends { category: string }>(
  pool: T[],
  n: number,
): T[] {
  if (pool.length <= n) return shuffle(pool);
  const byCat = new Map<string, T[]>();
  for (const q of shuffle(pool)) {
    const list = byCat.get(q.category) ?? [];
    list.push(q);
    byCat.set(q.category, list);
  }
  const picked: T[] = [];
  const cats = shuffle([...byCat.keys()]);
  // Round-robin one per category until we have n.
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const c of cats) {
      const list = byCat.get(c)!;
      if (list.length > 0) {
        picked.push(list.shift()!);
        progress = true;
        if (picked.length >= n) break;
      }
    }
  }
  return shuffle(picked);
}

function toClientQuestion(q: {
  id: string;
  prompt: string;
  category: string;
  sourceRef: string | null;
  options: Prisma.JsonValue;
}): ClientQuestion {
  const opts = Array.isArray(q.options)
    ? (q.options as unknown as StoredOption[])
    : [];
  // Present options in a randomised order so the correct position varies.
  return {
    id: q.id,
    prompt: q.prompt,
    category: q.category,
    sourceRef: q.sourceRef,
    options: shuffle(opts.map((o) => ({ id: o.id, text: o.text }))),
  };
}

async function buildReview(siteId: string): Promise<ReviewContent> {
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: {
      inductionContent: true,
      fireAssemblyPoint: true,
      firstAiderName: true,
      firstAiderLocation: true,
      firstAiderNumber: true,
      nearestHospital: true,
      emergencyNumber: true,
    },
  });
  return {
    inductionContent: site?.inductionContent ?? '',
    fireAssemblyPoint: site?.fireAssemblyPoint ?? null,
    firstAiderName: site?.firstAiderName ?? null,
    firstAiderLocation: site?.firstAiderLocation ?? null,
    firstAiderNumber: site?.firstAiderNumber ?? null,
    nearestHospital: site?.nearestHospital ?? null,
    emergencyNumber: site?.emergencyNumber ?? null,
  };
}

/**
 * Start (or resume) the worker's knowledge check for a site. Resuming an
 * in-progress attempt for the same bank keeps the same sampled questions so a
 * reload doesn't reshuffle mid-check.
 */
export async function startAttempt(
  workerId: string,
  siteId: string,
): Promise<StartResult> {
  const config = await getEffectiveConfig(siteId);
  if (!config.enabled) return { state: 'not_required' };

  const ensured = await ensureReadyBank(siteId, config.requireManagerApproval);
  if (ensured.status !== 'READY' || !ensured.bankId) {
    // No usable bank → apply the site policy.
    if (config.unavailablePolicy === 'BLOCK') {
      return {
        state: 'blocked',
        message:
          'The knowledge check for this site isn’t ready yet. Please try again shortly or speak to the site manager.',
      };
    }
    return { state: 'not_required' }; // SKIP_FLAGGED — recorded at check-in.
  }

  const bankId = ensured.bankId;

  // Resume an existing in-progress attempt for this worker + bank.
  const existing = await prisma.knowledgeCheckAttempt.findFirst({
    where: { workerId, bankId, status: 'IN_PROGRESS', submissionId: null },
    orderBy: { startedAt: 'desc' },
  });

  const activeQuestions = await prisma.inductionQuestion.findMany({
    where: { bankId, active: true },
    select: {
      id: true,
      prompt: true,
      category: true,
      sourceRef: true,
      options: true,
    },
  });
  const byId = new Map(activeQuestions.map((q) => [q.id, q]));

  let questionIds: string[];
  let attemptId: string;
  let answers: AnswersMap = {};

  if (existing) {
    const savedIds = (existing.questionIds as unknown as string[]).filter(
      (id) => byId.has(id),
    );
    // If the bank's active set changed enough that saved questions vanished,
    // resample rather than show a short check.
    if (savedIds.length === existing.questionCount) {
      attemptId = existing.id;
      questionIds = savedIds;
      answers = (existing.answers as unknown as AnswersMap) ?? {};
    } else {
      const sampled = sampleQuestions(
        activeQuestions,
        config.questionsPerAttempt,
      );
      questionIds = sampled.map((q) => q.id);
      const updated = await prisma.knowledgeCheckAttempt.update({
        where: { id: existing.id },
        data: { questionIds, answers: {}, questionCount: questionIds.length },
      });
      attemptId = updated.id;
    }
  } else {
    const sampled = sampleQuestions(
      activeQuestions,
      config.questionsPerAttempt,
    );
    questionIds = sampled.map((q) => q.id);
    const created = await prisma.knowledgeCheckAttempt.create({
      data: {
        workerId,
        jobSiteId: siteId,
        bankId,
        checklistVersion:
          (await loadBankInduction(siteId))?.checklistVersion ?? 0,
        questionIds,
        questionCount: questionIds.length,
      },
    });
    attemptId = created.id;
  }

  const questions = questionIds
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map(toClientQuestion);

  const answered: Record<string, boolean> = {};
  for (const [qid, a] of Object.entries(answers)) answered[qid] = a.correct;

  return {
    state: 'ready',
    attemptId,
    questions,
    review: await buildReview(siteId),
    answered,
  };
}

export type AnswerResult =
  | { ok: true; correct: boolean; explanation: string | null }
  | { ok: false; reason: 'not_found' | 'invalid' };

/**
 * Grade one answer server-side. Records the choice + try count. Returns whether
 * it was correct (and, once correct, the short explanation) — never the correct
 * option id, so a wrong guess can't be turned into the answer.
 */
export async function answerQuestion(
  workerId: string,
  attemptId: string,
  questionId: string,
  selectedOptionId: string,
): Promise<AnswerResult> {
  const attempt = await prisma.knowledgeCheckAttempt.findFirst({
    where: { id: attemptId, workerId, status: 'IN_PROGRESS' },
  });
  if (!attempt) return { ok: false, reason: 'not_found' };

  const sampled = attempt.questionIds as unknown as string[];
  if (!sampled.includes(questionId)) return { ok: false, reason: 'invalid' };

  const question = await prisma.inductionQuestion.findFirst({
    where: { id: questionId, bankId: attempt.bankId },
    select: { correctOptionId: true, explanation: true, options: true },
  });
  if (!question) return { ok: false, reason: 'not_found' };

  const opts = Array.isArray(question.options)
    ? (question.options as unknown as StoredOption[])
    : [];
  if (!opts.some((o) => o.id === selectedOptionId)) {
    return { ok: false, reason: 'invalid' };
  }

  const correct = selectedOptionId === question.correctOptionId;
  const answers = (attempt.answers as unknown as AnswersMap) ?? {};
  const prev = answers[questionId];
  answers[questionId] = {
    selectedOptionId,
    tries: (prev?.tries ?? 0) + 1,
    correct,
  };

  await prisma.knowledgeCheckAttempt.update({
    where: { id: attempt.id },
    data: { answers: answers as unknown as Prisma.InputJsonValue },
  });

  return {
    ok: true,
    correct,
    explanation: correct ? question.explanation : null,
  };
}

export type CompleteResult =
  | { ok: true; passed: true }
  | { ok: true; passed: false; remaining: string[] }
  | { ok: false; reason: 'not_found' };

/**
 * Finish the attempt. Passes only when every sampled question's latest answer is
 * correct (re-checked from stored state). Records duration + first-try score.
 */
export async function completeAttempt(
  workerId: string,
  attemptId: string,
): Promise<CompleteResult> {
  const attempt = await prisma.knowledgeCheckAttempt.findFirst({
    where: { id: attemptId, workerId },
  });
  if (!attempt) return { ok: false, reason: 'not_found' };
  if (attempt.status === 'PASSED') return { ok: true, passed: true };

  const sampled = attempt.questionIds as unknown as string[];
  const answers = (attempt.answers as unknown as AnswersMap) ?? {};
  const remaining = sampled.filter((id) => !answers[id]?.correct);
  if (remaining.length > 0) return { ok: true, passed: false, remaining };

  const incorrectFirstTry = sampled.filter(
    (id) => (answers[id]?.tries ?? 0) > 1,
  ).length;
  await prisma.knowledgeCheckAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'PASSED',
      completedAt: new Date(),
      incorrectFirstTryCount: incorrectFirstTry,
      durationSeconds: Math.max(
        0,
        Math.round((Date.now() - attempt.startedAt.getTime()) / 1000),
      ),
    },
  });
  return { ok: true, passed: true };
}

/** Record a worker's "Flag question" on a question in their attempt. */
export async function flagQuestion(
  workerId: string,
  attemptId: string,
  questionId: string,
  reason: string | undefined,
): Promise<boolean> {
  const attempt = await prisma.knowledgeCheckAttempt.findFirst({
    where: { id: attemptId, workerId },
    select: { bankId: true },
  });
  if (!attempt) return false;
  const question = await prisma.inductionQuestion.findFirst({
    where: { id: questionId, bankId: attempt.bankId },
    select: { id: true },
  });
  if (!question) return false;
  await prisma.questionFlag.create({
    data: {
      questionId,
      workerId,
      reason: reason?.slice(0, 500) || null,
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Check-in gate (used by the submission service)
// ---------------------------------------------------------------------------

export type GateResult =
  | { satisfied: true; attemptId: string | null; skipped: boolean }
  | { satisfied: false; reason: 'incomplete' | 'blocked' };

/**
 * The authoritative check-in gate (SC-005). Returns whether the worker may record
 * a compliant check-in for the site, and how the knowledge check was satisfied:
 *  - passed  → a PASSED attempt on the current bank is linked;
 *  - skipped → checks are on but no bank is available and policy is SKIP_FLAGGED.
 * A worker who skipped the check in the UI while a bank IS available is refused.
 */
export async function evaluateGate(
  workerId: string,
  siteId: string,
): Promise<GateResult> {
  const config = await getEffectiveConfig(siteId);
  if (!config.enabled)
    return { satisfied: true, attemptId: null, skipped: false };

  const ensured = await ensureReadyBank(siteId, config.requireManagerApproval);

  if (ensured.status === 'READY' && ensured.bankId) {
    const passed = await prisma.knowledgeCheckAttempt.findFirst({
      where: {
        workerId,
        bankId: ensured.bankId,
        status: 'PASSED',
        submissionId: null,
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });
    if (passed)
      return { satisfied: true, attemptId: passed.id, skipped: false };
    return { satisfied: false, reason: 'incomplete' };
  }

  // No usable bank (unavailable / pending approval / generation failed).
  if (config.unavailablePolicy === 'BLOCK') {
    return { satisfied: false, reason: 'blocked' };
  }
  return { satisfied: true, attemptId: null, skipped: true };
}
