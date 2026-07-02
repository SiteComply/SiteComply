import { prisma } from '@/lib/prisma';
import { formatDateUK } from '@/lib/datetime';

/**
 * On-Site Occupancy report data. `onSiteNow` figures are current (checked-in,
 * not checked out) and independent of the date range; the check-in activity
 * figures are bound to the range. Scoped to the caller-supplied `siteIds`
 * (already within the viewer's Assigned Sites).
 */

type Range = { gte?: Date; lt?: Date };

function rangeWhere(siteIds: string[], range: Range) {
  return {
    jobSiteId: { in: siteIds },
    ...(range.gte || range.lt ? { checkedInAt: range } : {}),
  };
}

export interface OccupancySummary {
  onSiteNow: number;
  sitesOccupied: number;
  checkInsInRange: number;
  avgPerDay: number;
  busiestDay: { date: string; count: number } | null;
  bySite: { name: string; onSiteNow: number; checkIns: number }[];
}

/** Aggregate occupancy figures — no worker identities. */
export async function getOccupancySummary(
  siteIds: string[],
  range: Range,
): Promise<OccupancySummary> {
  const empty: OccupancySummary = {
    onSiteNow: 0,
    sitesOccupied: 0,
    checkInsInRange: 0,
    avgPerDay: 0,
    busiestDay: null,
    bySite: [],
  };
  if (!siteIds.length) return empty;

  const [current, ranged] = await Promise.all([
    prisma.submission.findMany({
      where: { jobSiteId: { in: siteIds }, checkedOutAt: null },
      select: { jobSite: { select: { name: true } } },
    }),
    prisma.submission.findMany({
      where: rangeWhere(siteIds, range),
      select: { checkedInAt: true, jobSite: { select: { name: true } } },
    }),
  ]);

  const onSiteBySite = new Map<string, number>();
  for (const s of current) {
    onSiteBySite.set(s.jobSite.name, (onSiteBySite.get(s.jobSite.name) ?? 0) + 1);
  }
  const checkinsBySite = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const s of ranged) {
    checkinsBySite.set(s.jobSite.name, (checkinsBySite.get(s.jobSite.name) ?? 0) + 1);
    const d = formatDateUK(s.checkedInAt);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }

  const names = new Set<string>([...onSiteBySite.keys(), ...checkinsBySite.keys()]);
  const bySite = [...names]
    .map((name) => ({
      name,
      onSiteNow: onSiteBySite.get(name) ?? 0,
      checkIns: checkinsBySite.get(name) ?? 0,
    }))
    .sort((a, b) => b.onSiteNow - a.onSiteNow || b.checkIns - a.checkIns);

  let busiestDay: { date: string; count: number } | null = null;
  for (const [date, count] of byDay) {
    if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };
  }

  const days =
    range.gte && range.lt
      ? Math.max(1, Math.round((range.lt.getTime() - range.gte.getTime()) / 86400000))
      : 1;

  return {
    onSiteNow: current.length,
    sitesOccupied: onSiteBySite.size,
    checkInsInRange: ranged.length,
    avgPerDay: Math.round((ranged.length / days) * 10) / 10,
    busiestDay,
    bySite,
  };
}

export interface OnSiteWorkerRow {
  id: string;
  workerName: string;
  workerCompany: string;
  siteName: string;
  checkedInAt: Date;
}

/** Workers currently on site (checked in, not checked out) — worker-level. */
export async function getOnSiteWorkers(
  siteIds: string[],
  limit?: number,
): Promise<OnSiteWorkerRow[]> {
  if (!siteIds.length) return [];
  const subs = await prisma.submission.findMany({
    where: { jobSiteId: { in: siteIds }, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      checkedInAt: true,
      worker: { select: { fullName: true, company: true } },
      jobSite: { select: { name: true } },
    },
  });
  return subs.map((s) => ({
    id: s.id,
    workerName: s.worker.fullName,
    workerCompany: s.worker.company,
    siteName: s.jobSite.name,
    checkedInAt: s.checkedInAt,
  }));
}
