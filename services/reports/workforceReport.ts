import { prisma } from '@/lib/prisma';

/**
 * Workforce & Company report data — attendance grouped by company /
 * subcontractor over the date range. Purely aggregate (no worker identities);
 * scoped to the caller-supplied `siteIds` (within the viewer's Assigned Sites).
 */

type Range = { gte?: Date; lt?: Date };

export interface WorkforceSummary {
  companies: number;
  uniqueWorkers: number;
  checkInsInRange: number;
  sites: number;
  byCompany: { company: string; workers: number; checkIns: number }[];
}

export async function getWorkforceSummary(
  siteIds: string[],
  range: Range,
): Promise<WorkforceSummary> {
  const empty: WorkforceSummary = {
    companies: 0,
    uniqueWorkers: 0,
    checkInsInRange: 0,
    sites: 0,
    byCompany: [],
  };
  if (!siteIds.length) return empty;

  const subs = await prisma.submission.findMany({
    where: {
      jobSiteId: { in: siteIds },
      ...(range.gte || range.lt ? { checkedInAt: range } : {}),
    },
    select: {
      workerId: true,
      jobSiteId: true,
      worker: { select: { company: true } },
    },
  });

  const byCompanyMap = new Map<string, { workers: Set<string>; checkIns: number }>();
  const workers = new Set<string>();
  const sites = new Set<string>();
  for (const s of subs) {
    workers.add(s.workerId);
    sites.add(s.jobSiteId);
    const m = byCompanyMap.get(s.worker.company) ?? { workers: new Set<string>(), checkIns: 0 };
    m.workers.add(s.workerId);
    m.checkIns += 1;
    byCompanyMap.set(s.worker.company, m);
  }

  const byCompany = [...byCompanyMap.entries()]
    .map(([company, m]) => ({ company, workers: m.workers.size, checkIns: m.checkIns }))
    .sort((a, b) => b.checkIns - a.checkIns);

  return {
    companies: byCompanyMap.size,
    uniqueWorkers: workers.size,
    checkInsInRange: subs.length,
    sites: sites.size,
    byCompany,
  };
}
