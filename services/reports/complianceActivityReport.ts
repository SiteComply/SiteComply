import { OccurrenceStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  londonDateStr,
  addDays,
} from '@/services/compliance/occurrenceGenerator';
import { weekCommencingMonday } from '@/lib/datetime';

/**
 * The project's existing report range shape (see reportFilters): a UTC
 * half-open [gte, lt) window. Reused rather than redefined so the filter bar,
 * the CSV export and this service all speak the same language.
 */
export type DateRange = { gte?: Date; lt?: Date };

/**
 * SC-020 Phase 3 — reporting over the scheduler's existing data.
 *
 * Reads ComplianceSchedule / ComplianceOccurrence and the SC-014 audit scores
 * they produced. NO new capture, no duplicate reporting structures — everything
 * here is a query over what Phases 1 and 2 already record.
 *
 * Two honesty rules run through this file:
 *
 * 1. A completion percentage is over occurrences that have actually been
 *    GENERATED. Until Phase 4's timer, generation happens when someone views a
 *    window, so a rate over an unvisited period would flatter or distort. The
 *    report states this rather than quietly implying full coverage.
 * 2. "No data yet" is reported as exactly that, never as 0%. A new site with no
 *    completed activities is not a site failing its compliance.
 */

export interface ComplianceKpis {
  /** Not yet due and not complete. */
  upcoming: number;
  /** Anything not complete — upcoming plus overdue. */
  outstanding: number;
  overdue: number;
  escalated: number;
  completed: number;
  /** Occurrences whose due date has passed or is today (the completion base). */
  due: number;
  /** completed / due, or null when nothing is due yet. */
  completionRate: number | null;
  activeSchedules: number;
}

/**
 * Translate a UTC [gte, lt) range into a dueDateLocal filter. `lt` is exclusive,
 * so the last local day is `lt - 1 day` — off-by-one here would silently drop or
 * add a day's activities from every figure in the report.
 */
function dueDateWindow(range?: DateRange) {
  if (!range || (!range.gte && !range.lt)) return {};
  const filter: { gte?: string; lte?: string } = {};
  if (range.gte) filter.gte = londonDateStr(range.gte);
  if (range.lt) {
    filter.lte = londonDateStr(new Date(range.lt.getTime() - 86400000));
  }
  return { dueDateLocal: filter };
}

export async function getComplianceKpis(
  siteIds: string[],
  range?: DateRange,
): Promise<ComplianceKpis> {
  const empty: ComplianceKpis = {
    upcoming: 0,
    outstanding: 0,
    overdue: 0,
    escalated: 0,
    completed: 0,
    due: 0,
    completionRate: null,
    activeSchedules: 0,
  };
  if (siteIds.length === 0) return empty;

  const today = londonDateStr(new Date());
  const where = {
    jobSiteId: { in: siteIds },
    ...dueDateWindow(range),
  };

  const [rows, activeSchedules] = await Promise.all([
    prisma.complianceOccurrence.findMany({
      where,
      select: {
        status: true,
        dueDateLocal: true,
        escalatedAt: true,
      },
    }),
    prisma.complianceSchedule.count({
      where: { jobSiteId: { in: siteIds }, active: true },
    }),
  ]);

  let upcoming = 0;
  let overdue = 0;
  let completed = 0;
  let due = 0;
  let escalated = 0;

  for (const r of rows) {
    const isDone = r.status === OccurrenceStatus.COMPLETED;
    const isPast = r.dueDateLocal <= today;
    if (isDone) completed++;
    if (isPast) due++;
    if (!isDone && r.dueDateLocal < today) overdue++;
    if (!isDone && r.dueDateLocal >= today) upcoming++;
    if (r.escalatedAt) escalated++;
  }

  return {
    upcoming,
    outstanding: upcoming + overdue,
    overdue,
    escalated,
    completed,
    due,
    // Null, not zero, when nothing has come due — "no data" and "0%" mean very
    // different things to someone reading a compliance report.
    completionRate: due === 0 ? null : Math.round((completed / due) * 100),
    activeSchedules,
  };
}

export interface SiteComplianceScore {
  siteId: string;
  siteName: string;
  due: number;
  completed: number;
  overdue: number;
  escalated: number;
  /** The site compliance score = completion rate only, per the approved decision. */
  completionRate: number | null;
  /**
   * Average SC-014 audit score across the audits these activities produced,
   * reported SEPARATELY and never blended into the score above: a site can
   * complete every inspection and still be failing them, and one merged number
   * would hide exactly that.
   */
  averageAuditScore: number | null;
  auditsScored: number;
}

export async function getSiteComplianceScores(
  siteIds: string[],
  range?: DateRange,
): Promise<SiteComplianceScore[]> {
  if (siteIds.length === 0) return [];
  const today = londonDateStr(new Date());

  const sites = await prisma.jobSite.findMany({
    where: { id: { in: siteIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const occurrences = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: siteIds },
      ...dueDateWindow(range),
    },
    select: {
      jobSiteId: true,
      status: true,
      dueDateLocal: true,
      escalatedAt: true,
      audit: {
        select: { calculatedPercent: true, scoringEnabled: true },
      },
    },
  });

  return sites.map((site) => {
    const mine = occurrences.filter((o) => o.jobSiteId === site.id);
    let due = 0;
    let completed = 0;
    let overdue = 0;
    let escalated = 0;
    const scores: number[] = [];

    for (const o of mine) {
      const isDone = o.status === OccurrenceStatus.COMPLETED;
      if (o.dueDateLocal <= today) due++;
      if (isDone) completed++;
      if (!isDone && o.dueDateLocal < today) overdue++;
      if (o.escalatedAt) escalated++;
      // Only audits with SC-014 scoring switched on contribute a score.
      if (o.audit?.scoringEnabled && o.audit.calculatedPercent !== null) {
        scores.push(o.audit.calculatedPercent);
      }
    }

    return {
      siteId: site.id,
      siteName: site.name,
      due,
      completed,
      overdue,
      escalated,
      completionRate: due === 0 ? null : Math.round((completed / due) * 100),
      averageAuditScore:
        scores.length === 0
          ? null
          : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      auditsScored: scores.length,
    };
  });
}

export interface TrendBucket {
  /** Monday-commencing week, yyyy-mm-dd. */
  weekCommencing: string;
  due: number;
  completed: number;
  overdue: number;
  completionRate: number | null;
}

/** Rolling 12-week trend, in Monday-commencing weeks (the SC-010 convention). */
export const TREND_WEEKS = 12;

export async function getComplianceTrend(
  siteIds: string[],
  weeks = TREND_WEEKS,
): Promise<TrendBucket[]> {
  if (siteIds.length === 0) return [];
  const today = londonDateStr(new Date());
  const thisMonday = weekCommencingMonday(today);
  const firstMonday = addDays(thisMonday, -7 * (weeks - 1));

  const rows = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: siteIds },
      dueDateLocal: { gte: firstMonday, lte: today },
    },
    select: { status: true, dueDateLocal: true },
  });

  // Pre-seed every week so a quiet week reads as a real zero rather than a gap
  // in the series.
  const buckets = new Map<string, TrendBucket>();
  for (let i = 0; i < weeks; i++) {
    const wc = addDays(firstMonday, i * 7);
    buckets.set(wc, {
      weekCommencing: wc,
      due: 0,
      completed: 0,
      overdue: 0,
      completionRate: null,
    });
  }

  for (const r of rows) {
    const wc = weekCommencingMonday(r.dueDateLocal);
    const b = buckets.get(wc);
    if (!b) continue;
    b.due++;
    if (r.status === OccurrenceStatus.COMPLETED) b.completed++;
    else if (r.dueDateLocal < today) b.overdue++;
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    completionRate:
      b.due === 0 ? null : Math.round((b.completed / b.due) * 100),
  }));
}

export interface ComplianceActivityRow {
  id: string;
  activity: string;
  siteName: string;
  dueDateLocal: string;
  timeOfDay: string;
  status: string;
  assignee: string;
  overdue: boolean;
  escalatedAt: string | null;
  escalatedToRole: string | null;
  completedAt: string | null;
  completedByName: string | null;
  auditScore: number | null;
}

/** Detail rows for the table and the CSV export. */
export async function getComplianceActivityRows(
  siteIds: string[],
  range?: DateRange,
): Promise<ComplianceActivityRow[]> {
  if (siteIds.length === 0) return [];
  const today = londonDateStr(new Date());

  const rows = await prisma.complianceOccurrence.findMany({
    where: {
      jobSiteId: { in: siteIds },
      ...dueDateWindow(range),
    },
    orderBy: [{ dueDateLocal: 'desc' }, { timeOfDay: 'asc' }],
    take: 2000,
    include: {
      schedule: {
        select: { title: true, auditTemplate: { select: { name: true } } },
      },
      jobSite: { select: { name: true } },
      audit: { select: { calculatedPercent: true, scoringEnabled: true } },
    },
  });

  // Resolve assignee display names in one pass rather than per row.
  const userIds = [
    ...new Set(rows.map((r) => r.assignedPlatformUserId).filter(Boolean)),
  ] as string[];
  const workerIds = [
    ...new Set(rows.map((r) => r.assignedWorkerId).filter(Boolean)),
  ] as string[];
  const [users, workers] = await Promise.all([
    userIds.length
      ? prisma.platformUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    workerIds.length
      ? prisma.worker.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const workerName = new Map(workers.map((w) => [w.id, w.fullName]));

  return rows.map((r) => ({
    id: r.id,
    activity: r.schedule.title || r.schedule.auditTemplate.name,
    siteName: r.jobSite.name,
    dueDateLocal: r.dueDateLocal,
    timeOfDay: r.timeOfDay,
    status: r.status,
    assignee:
      r.assigneeKind === 'ROLE'
        ? (r.assignedRole ?? 'Role')
        : r.assigneeKind === 'USER'
          ? (userName.get(r.assignedPlatformUserId ?? '') ?? 'Unknown user')
          : (workerName.get(r.assignedWorkerId ?? '') ?? 'Unknown worker'),
    overdue: r.status !== OccurrenceStatus.COMPLETED && r.dueDateLocal < today,
    escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : null,
    escalatedToRole: r.escalatedToRole ?? null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    completedByName: r.completedByName ?? null,
    auditScore:
      r.audit?.scoringEnabled && r.audit.calculatedPercent !== null
        ? r.audit.calculatedPercent
        : null,
  }));
}

/**
 * The caveat shown in the report footer and the CSV. Stated rather than implied:
 * a completion rate over occurrences that were never generated would overstate
 * performance.
 *
 * Updated in SC-020 Phase 4: scheduled generation now runs hourly, so the old
 * "until scheduled generation is enabled" wording was not just stale but
 * actively misleading — it told readers the figures were less trustworthy than
 * they now are. The remaining caveat is real and narrower: the horizon is
 * bounded, so activities beyond it genuinely do not exist yet.
 */
export const GENERATION_CAVEAT =
  'Figures cover compliance activities that have been generated. Scheduled generation runs hourly on a rolling 60-day horizon, so activities due beyond that horizon are not yet included.';
