import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  loadBankInduction,
  regenerateBank,
} from '@/services/knowledgeChecks/questionBankService';

/**
 * Manager-facing views/actions over a site's knowledge-check question bank
 * (SC-005): preview the current bank (questions + correct answers), regenerate,
 * approve (when the site requires approval), and review/resolve worker flags.
 *
 * All are gated on the `sites` "edit" permission (site managers included) and the
 * site being in the viewer's scope.
 */

export interface AdminQuestion {
  id: string;
  order: number;
  category: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  sourceRef: string | null;
  explanation: string | null;
  active: boolean;
  flagCount: number;
}

export interface BankPreview {
  status: string | null; //  bank status, or null if none generated yet
  approvedAt: string | null;
  approvedByName: string | null;
  provider: string | null;
  model: string | null;
  generatedAtLabel: string | null;
  error: string | null;
  questionCount: number;
  questions: AdminQuestion[];
  /** True when the current induction has no bank for its exact content yet. */
  stale: boolean;
}

/** The current induction state's bank for a site, for the management panel. */
export async function getBankPreviewForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<BankPreview | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const induction = await loadBankInduction(siteId);
  if (!induction) {
    return {
      status: null,
      approvedAt: null,
      approvedByName: null,
      provider: null,
      model: null,
      generatedAtLabel: null,
      error: null,
      questionCount: 0,
      questions: [],
      stale: false,
    };
  }

  const bank = await prisma.inductionQuestionBank.findUnique({
    where: {
      jobSiteId_checklistVersion_contentHash: {
        jobSiteId: siteId,
        checklistVersion: induction.checklistVersion,
        contentHash: induction.contentHash,
      },
    },
    include: {
      questions: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { flags: true } } },
      },
    },
  });

  if (!bank) {
    return {
      status: null,
      approvedAt: null,
      approvedByName: null,
      provider: null,
      model: null,
      generatedAtLabel: null,
      error: null,
      questionCount: 0,
      questions: [],
      stale: true, // induction exists but no bank for its current content
    };
  }

  return {
    status: bank.status,
    approvedAt: bank.approvedAt ? bank.approvedAt.toISOString() : null,
    approvedByName: bank.approvedByName,
    provider: bank.provider,
    model: bank.model,
    generatedAtLabel: bank.updatedAt.toISOString(),
    error: bank.error,
    questionCount: bank.questions.filter((q) => q.active).length,
    stale: false,
    questions: bank.questions.map((q) => ({
      id: q.id,
      order: q.order,
      category: q.category,
      prompt: q.prompt,
      options: Array.isArray(q.options)
        ? (q.options as unknown as { id: string; text: string }[])
        : [],
      correctOptionId: q.correctOptionId,
      sourceRef: q.sourceRef,
      explanation: q.explanation,
      active: q.active,
      flagCount: q._count.flags,
    })),
  };
}

export type BankActionResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'unavailable' };

function canManage(viewer: PlatformViewer, siteId: string): boolean {
  return (
    permits(viewer.role, 'sites', 'edit') && viewer.siteIds.includes(siteId)
  );
}

/** Regenerate the site's bank for its current induction state. */
export async function regenerateForViewer(
  viewer: PlatformViewer,
  siteId: string,
  requireApproval: boolean,
): Promise<BankActionResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };
  const result = await regenerateBank(siteId, requireApproval);
  if (result.status === 'UNAVAILABLE')
    return { ok: false, reason: 'unavailable' };
  return { ok: true };
}

/** Approve the current READY-but-unapproved bank so workers can be served it. */
export async function approveBankForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<BankActionResult> {
  if (!canManage(viewer, siteId)) return { ok: false, reason: 'forbidden' };
  const induction = await loadBankInduction(siteId);
  if (!induction) return { ok: false, reason: 'not_found' };

  const bank = await prisma.inductionQuestionBank.findUnique({
    where: {
      jobSiteId_checklistVersion_contentHash: {
        jobSiteId: siteId,
        checklistVersion: induction.checklistVersion,
        contentHash: induction.contentHash,
      },
    },
    select: { id: true, status: true },
  });
  if (!bank || bank.status !== 'READY')
    return { ok: false, reason: 'not_found' };

  await prisma.inductionQuestionBank.update({
    where: { id: bank.id },
    data: { approvedAt: new Date(), approvedByName: viewer.name },
  });
  return { ok: true };
}

/** Withdraw a question (deactivate) — used from the flag-review list. */
export async function setQuestionActiveForViewer(
  viewer: PlatformViewer,
  questionId: string,
  active: boolean,
): Promise<BankActionResult> {
  if (!permits(viewer.role, 'sites', 'edit'))
    return { ok: false, reason: 'forbidden' };
  const question = await prisma.inductionQuestion.findFirst({
    where: { id: questionId, bank: { jobSiteId: { in: viewer.siteIds } } },
    select: { id: true },
  });
  if (!question) return { ok: false, reason: 'not_found' };
  await prisma.inductionQuestion.update({
    where: { id: questionId },
    data: { active },
  });
  // Resolve any open flags on it.
  await prisma.questionFlag.updateMany({
    where: { questionId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return { ok: true };
}

export interface FlaggedQuestion {
  questionId: string;
  prompt: string;
  siteId: string;
  flagCount: number;
  active: boolean;
  lastFlaggedLabel: string;
}

/** Open (unresolved) question flags across the viewer's sites. */
export async function listOpenFlagsForViewer(
  viewer: PlatformViewer,
  siteId?: string,
): Promise<FlaggedQuestion[]> {
  if (viewer.siteIds.length === 0) return [];
  const sites = siteId
    ? [siteId].filter((s) => viewer.siteIds.includes(s))
    : viewer.siteIds;
  if (sites.length === 0) return [];

  const flags = await prisma.questionFlag.findMany({
    where: {
      resolvedAt: null,
      question: { bank: { jobSiteId: { in: sites } } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      question: {
        select: {
          id: true,
          prompt: true,
          active: true,
          bank: { select: { jobSiteId: true } },
        },
      },
    },
  });

  const byQuestion = new Map<string, FlaggedQuestion>();
  for (const f of flags) {
    const q = f.question;
    const existing = byQuestion.get(q.id);
    if (existing) {
      existing.flagCount += 1;
    } else {
      byQuestion.set(q.id, {
        questionId: q.id,
        prompt: q.prompt,
        siteId: q.bank.jobSiteId,
        flagCount: 1,
        active: q.active,
        lastFlaggedLabel: f.createdAt.toISOString(),
      });
    }
  }
  return [...byQuestion.values()];
}
