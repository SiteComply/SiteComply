import { prisma } from '@/lib/prisma';

/**
 * Knowledge Checks report data (SC-005). Scoped to caller-supplied `siteIds`
 * (already intersected with the viewer's Assigned Sites) and the attempt
 * completion date range. `getKnowledgeCheckRows` returns worker-level attempt
 * detail (non-Client views + CSV); `getKnowledgeCheckSummary` returns
 * aggregate-only figures (safe for Client).
 */

type Range = { gte?: Date; lt?: Date };

function attemptWhere(siteIds: string[], range: Range) {
  return {
    jobSiteId: { in: siteIds },
    status: 'PASSED' as const,
    ...(range.gte || range.lt ? { completedAt: range } : {}),
  };
}

export interface KnowledgeCheckRow {
  id: string;
  completedAt: Date | null;
  workerName: string;
  workerCompany: string;
  siteName: string;
  siteRef: string;
  questionCount: number;
  incorrectFirstTry: number;
  durationSeconds: number | null;
}

export async function getKnowledgeCheckRows(
  siteIds: string[],
  range: Range,
  limit?: number,
): Promise<KnowledgeCheckRow[]> {
  if (!siteIds.length) return [];
  const rows = await prisma.knowledgeCheckAttempt.findMany({
    where: attemptWhere(siteIds, range),
    orderBy: { completedAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      completedAt: true,
      questionCount: true,
      incorrectFirstTryCount: true,
      durationSeconds: true,
      worker: { select: { fullName: true, company: true } },
      jobSite: { select: { name: true, jobReference: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    completedAt: r.completedAt,
    workerName: r.worker.fullName,
    workerCompany: r.worker.company,
    siteName: r.jobSite.name,
    siteRef: r.jobSite.jobReference,
    questionCount: r.questionCount,
    incorrectFirstTry: r.incorrectFirstTryCount,
    durationSeconds: r.durationSeconds,
  }));
}

export interface KnowledgeCheckSummary {
  passed: number; //           attempts completed at 100%
  firstTimePass: number; //    passed with no wrong first answers
  skipped: number; //          check-ins where the check was skipped (no bank)
  flaggedOpen: number; //      open (unresolved) question flags in scope
  bySite: { name: string; passed: number }[];
}

export async function getKnowledgeCheckSummary(
  siteIds: string[],
  range: Range,
): Promise<KnowledgeCheckSummary> {
  const empty: KnowledgeCheckSummary = {
    passed: 0,
    firstTimePass: 0,
    skipped: 0,
    flaggedOpen: 0,
    bySite: [],
  };
  if (!siteIds.length) return empty;

  const attempts = await prisma.knowledgeCheckAttempt.findMany({
    where: attemptWhere(siteIds, range),
    select: {
      incorrectFirstTryCount: true,
      jobSite: { select: { name: true } },
    },
  });

  const passed = attempts.length;
  const firstTimePass = attempts.filter(
    (a) => a.incorrectFirstTryCount === 0,
  ).length;
  const bySiteMap = new Map<string, number>();
  for (const a of attempts) {
    bySiteMap.set(a.jobSite.name, (bySiteMap.get(a.jobSite.name) ?? 0) + 1);
  }
  const bySite = [...bySiteMap.entries()]
    .map(([name, p]) => ({ name, passed: p }))
    .sort((a, b) => b.passed - a.passed);

  const skipped = await prisma.submission.count({
    where: {
      jobSiteId: { in: siteIds },
      knowledgeCheckSkipped: true,
      ...(range.gte || range.lt ? { checkedInAt: range } : {}),
    },
  });

  const flaggedOpen = await prisma.questionFlag.count({
    where: {
      resolvedAt: null,
      question: { bank: { jobSiteId: { in: siteIds } } },
    },
  });

  return { passed, firstTimePass, skipped, flaggedOpen, bySite };
}
