import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toDateInputValue } from '@/lib/datetime';

/**
 * Organisation Overview data (Director-only). Aggregates the whole in-scope
 * portfolio over the date range: KPI totals, attendance trend, contractor
 * breakdown and per-site performance. Purely aggregate (no worker identities).
 * Callers pass the in-scope sites (id + name) so every site appears.
 */

type Range = { gte?: Date; lt?: Date };

/**
 * A percentage, or null when there is nothing to take a percentage OF.
 *
 * `d === 0` used to yield 0, so a site with no check-ins in the period was
 * reported as "0% compliant" on screen and in the CSV — indistinguishable from a
 * site where every worker failed. No data and total failure are different facts
 * and a director acts on them differently.
 */
function pct(n: number, d: number): number | null {
  return d ? Math.round((n / d) * 100) : null;
}

export interface OrgOverview {
  totalSites: number;
  activeWorkers: number;
  checkIns: number;
  onSiteNow: number;
  companies: number;
  compliancePct: number | null;
  inductionPct: number | null;
  avgPerDay: number;
  /** Check-ins per day (yyyy-mm-dd sorted ascending). */
  trend: { date: string; count: number }[];
  topCompanies: { company: string; workers: number; checkIns: number }[];
  sitePerformance: {
    siteId: string;
    siteName: string;
    checkIns: number;
    workers: number;
    onSiteNow: number;
    compliancePct: number | null;
  }[];
}

export async function getOrgOverview(
  sites: { id: string; name: string }[],
  range: Range,
): Promise<OrgOverview> {
  const empty: OrgOverview = {
    totalSites: 0,
    activeWorkers: 0,
    checkIns: 0,
    onSiteNow: 0,
    companies: 0,
    // No sites in scope: no data, not 0%.
    compliancePct: null,
    inductionPct: null,
    avgPerDay: 0,
    trend: [],
    topCompanies: [],
    sitePerformance: [],
  };
  if (!sites.length) return empty;

  const siteIds = sites.map((s) => s.id);
  const [rangeSubs, current] = await Promise.all([
    prisma.submission.findMany({
      where: {
        jobSiteId: { in: siteIds },
        ...(range.gte || range.lt ? { checkedInAt: range } : {}),
      },
      select: {
        jobSiteId: true,
        status: true,
        ppeConfirmed: true,
        rulesAcknowledged: true,
        safeWorkingAgreed: true,
        gdprConsent: true,
        workerId: true,
        checkedInAt: true,
        worker: { select: { company: true } },
      },
    }),
    prisma.submission.findMany({
      where: { jobSiteId: { in: siteIds }, checkedOutAt: null },
      select: { jobSiteId: true },
    }),
  ]);

  const onSiteBySite = new Map<string, number>();
  for (const s of current) {
    onSiteBySite.set(s.jobSiteId, (onSiteBySite.get(s.jobSiteId) ?? 0) + 1);
  }

  const workers = new Set<string>();
  const companies = new Set<string>();
  const dayMap = new Map<string, number>();
  const byCompany = new Map<string, { workers: Set<string>; checkIns: number }>();
  const bySite = new Map<string, { workers: Set<string>; checkIns: number; compliant: number }>();
  let totalCompliant = 0;
  let totalInduction = 0;

  for (const s of rangeSubs) {
    workers.add(s.workerId);
    companies.add(s.worker.company);
    const day = toDateInputValue(s.checkedInAt);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);

    const c = byCompany.get(s.worker.company) ?? { workers: new Set<string>(), checkIns: 0 };
    c.workers.add(s.workerId);
    c.checkIns += 1;
    byCompany.set(s.worker.company, c);

    const b = bySite.get(s.jobSiteId) ?? { workers: new Set<string>(), checkIns: 0, compliant: 0 };
    b.workers.add(s.workerId);
    b.checkIns += 1;
    if (s.status === SubmissionStatus.COMPLIANT) {
      b.compliant += 1;
      totalCompliant += 1;
    }
    bySite.set(s.jobSiteId, b);

    if (s.ppeConfirmed && s.rulesAcknowledged && s.safeWorkingAgreed && s.gdprConsent) {
      totalInduction += 1;
    }
  }

  const trend = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const topCompanies = [...byCompany.entries()]
    .map(([company, m]) => ({ company, workers: m.workers.size, checkIns: m.checkIns }))
    .sort((a, b) => b.checkIns - a.checkIns)
    .slice(0, 8);

  const sitePerformance = sites
    .map((s) => {
      const b = bySite.get(s.id);
      return {
        siteId: s.id,
        siteName: s.name,
        checkIns: b?.checkIns ?? 0,
        workers: b?.workers.size ?? 0,
        onSiteNow: onSiteBySite.get(s.id) ?? 0,
        compliancePct: pct(b?.compliant ?? 0, b?.checkIns ?? 0),
      };
    })
    .sort((a, b) => b.checkIns - a.checkIns);

  const days =
    range.gte && range.lt
      ? Math.max(1, Math.round((range.lt.getTime() - range.gte.getTime()) / 86400000))
      : 1;

  return {
    totalSites: sites.length,
    activeWorkers: workers.size,
    checkIns: rangeSubs.length,
    onSiteNow: current.length,
    companies: companies.size,
    compliancePct: pct(totalCompliant, rangeSubs.length),
    inductionPct: pct(totalInduction, rangeSubs.length),
    avgPerDay: Math.round((rangeSubs.length / days) * 10) / 10,
    trend,
    topCompanies,
    sitePerformance,
  };
}
