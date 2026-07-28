import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  toDateInputValue,
  weekCommencingMonday,
  ukDateRangeToUtc,
  addDaysToDateStr,
} from '@/lib/datetime';
import { checkInReference } from '@/services/submissions/submissionService';

/**
 * Attendance History & Timesheets (SC-010).
 *
 * Purely a read/aggregation layer over existing `Submission` records — no new
 * tables. Everything is scoped to ONE worker (their own attendance) and derived:
 *   - total time on site = checkedOutAt − checkedInAt (GROSS; breaks are not
 *     tracked in v1),
 *   - a record is `onsite` if it's still open and started on today's London day,
 *     `incomplete` if it's open but from a previous day (a missed check-out), and
 *     `complete` once checked out.
 * Timesheet totals only count completed time; on-site (still open) time is shown
 * but not summed, and incomplete records contribute no hours.
 */

export type AttendanceState = 'complete' | 'incomplete' | 'onsite';

export interface AttendanceRecord {
  submissionId: string;
  reference: string;
  siteId: string;
  siteName: string;
  jobReference: string;
  /** London calendar day of the check-in (yyyy-mm-dd), for grouping. */
  dateStr: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  /** Completed minutes on site, or null when not yet checked out. */
  minutes: number | null;
  state: AttendanceState;
  locationVerified: boolean;
}

const SELECT = {
  id: true,
  jobSiteId: true,
  checkedInAt: true,
  checkedOutAt: true,
  locationVerified: true,
  jobSite: { select: { name: true, jobReference: true } },
} as const;

type Row = Prisma.SubmissionGetPayload<{ select: typeof SELECT }>;

function classify(row: Row, now: Date): AttendanceRecord {
  const inMs = row.checkedInAt.getTime();
  let state: AttendanceState;
  let minutes: number | null;
  if (row.checkedOutAt) {
    state = 'complete';
    minutes = Math.max(
      0,
      Math.round((row.checkedOutAt.getTime() - inMs) / 60000),
    );
  } else if (toDateInputValue(row.checkedInAt) === toDateInputValue(now)) {
    // Still open, checked in today → the worker is on site now (not an error).
    state = 'onsite';
    minutes = null;
  } else {
    // Open but from a previous day → a missed check-out.
    state = 'incomplete';
    minutes = null;
  }
  return {
    submissionId: row.id,
    reference: checkInReference(row.id),
    siteId: row.jobSiteId,
    siteName: row.jobSite.name,
    jobReference: row.jobSite.jobReference,
    dateStr: toDateInputValue(row.checkedInAt),
    checkedInAt: row.checkedInAt,
    checkedOutAt: row.checkedOutAt,
    minutes,
    state,
    locationVerified: row.locationVerified,
  };
}

export interface AttendanceFilter {
  siteId?: string;
  /** Inclusive UK from/to as yyyy-mm-dd. */
  from?: string;
  to?: string;
}

/** A worker's own attendance records, newest first, optionally filtered. */
export async function listWorkerAttendance(
  workerId: string,
  filter: AttendanceFilter = {},
  now: Date = new Date(),
): Promise<AttendanceRecord[]> {
  const range = ukDateRangeToUtc(filter.from, filter.to);
  const where: Prisma.SubmissionWhereInput = { workerId };
  if (filter.siteId) where.jobSiteId = filter.siteId;
  if (range.gte || range.lt) where.checkedInAt = range;
  const rows = await prisma.submission.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    select: SELECT,
  });
  return rows.map((r) => classify(r, now));
}

export interface AttendanceSummary {
  /** Distinct London days with at least one check-in. */
  daysOnSite: number;
  /** Sum of completed minutes on site in the period. */
  totalMinutes: number;
  /** Average completed minutes per day-on-site (0 if none). */
  averageDayMinutes: number;
  /** Records still open from a previous day (missed check-outs). */
  incompleteCount: number;
  /** Records still open from today (on site now). */
  onsiteCount: number;
  /** % of decided records (complete vs incomplete) that are complete. */
  completePct: number;
  recordCount: number;
}

export function summarise(records: AttendanceRecord[]): AttendanceSummary {
  const days = new Set<string>();
  let totalMinutes = 0;
  let incompleteCount = 0;
  let onsiteCount = 0;
  let complete = 0;
  for (const r of records) {
    days.add(r.dateStr);
    if (r.state === 'complete') {
      complete += 1;
      totalMinutes += r.minutes ?? 0;
    } else if (r.state === 'incomplete') {
      incompleteCount += 1;
    } else {
      onsiteCount += 1;
    }
  }
  const decided = complete + incompleteCount;
  const daysOnSite = days.size;
  return {
    daysOnSite,
    totalMinutes,
    averageDayMinutes: daysOnSite ? Math.round(totalMinutes / daysOnSite) : 0,
    incompleteCount,
    onsiteCount,
    completePct: decided ? Math.round((complete / decided) * 100) : 100,
    recordCount: records.length,
  };
}

export interface AttendanceWeek {
  weekCommencing: string; // yyyy-mm-dd (Monday)
  totalMinutes: number;
  records: AttendanceRecord[]; // ascending by check-in within the week
}

/** Group records into weeks (Mon-commencing); weeks desc, records asc within. */
export function groupByWeek(records: AttendanceRecord[]): AttendanceWeek[] {
  const byWeek = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const wk = weekCommencingMonday(r.dateStr);
    (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(r);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekCommencing, recs]) => ({
      weekCommencing,
      totalMinutes: recs.reduce((s, r) => s + (r.minutes ?? 0), 0),
      records: recs.sort(
        (a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime(),
      ),
    }));
}

// ── Fixed-period helpers (for the dashboard card + day-detail timesheet) ─────

function londonDayStr(now: Date): string {
  return toDateInputValue(now);
}

/** This week's Mon–Sun UK date range (yyyy-mm-dd strings). */
export function currentWeekRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const today = londonDayStr(now);
  const from = weekCommencingMonday(today);
  return { from, to: addDaysToDateStr(from, 6) };
}

/** This month's 1st–last UK date range (yyyy-mm-dd strings). */
export function currentMonthRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const today = londonDayStr(now); // yyyy-mm-dd
  const from = `${today.slice(0, 8)}01`;
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const to = `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** Number of Mon–Fri days in an inclusive yyyy-mm-dd range (working days). */
export function workingDaysInRange(from: string, to: string): number {
  let count = 0;
  let cursor = from;
  for (let i = 0; i < 366 && cursor <= to; i++) {
    const [y, m, d] = cursor.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
    cursor = addDaysToDateStr(cursor, 1);
  }
  return count;
}

export interface TimesheetSummary {
  weekMinutes: number;
  monthMinutes: number;
  monthDays: number;
  monthAverageDayMinutes: number;
}

/** This-week / this-month totals for a worker (the timesheet summary block). */
export async function getTimesheetSummary(
  workerId: string,
  now: Date = new Date(),
): Promise<TimesheetSummary> {
  const week = currentWeekRange(now);
  const month = currentMonthRange(now);
  const [weekRecs, monthRecs] = await Promise.all([
    listWorkerAttendance(workerId, week, now),
    listWorkerAttendance(workerId, month, now),
  ]);
  const weekSum = summarise(weekRecs);
  const monthSum = summarise(monthRecs);
  return {
    weekMinutes: weekSum.totalMinutes,
    monthMinutes: monthSum.totalMinutes,
    monthDays: monthSum.daysOnSite,
    monthAverageDayMinutes: monthSum.averageDayMinutes,
  };
}

export interface DayDetail {
  record: AttendanceRecord;
  siteAddress: string;
  timesheet: TimesheetSummary;
}

/** One attendance record (ownership-scoped) with site + timesheet context. */
export async function getWorkerAttendanceDetail(
  workerId: string,
  submissionId: string,
  now: Date = new Date(),
): Promise<DayDetail | null> {
  const row = await prisma.submission.findFirst({
    where: { id: submissionId, workerId },
    select: {
      ...SELECT,
      jobSite: {
        select: {
          name: true,
          jobReference: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          postcode: true,
        },
      },
    },
  });
  if (!row) return null;
  const record = classify(row as unknown as Row, now);
  const address = [
    row.jobSite.addressLine1,
    row.jobSite.addressLine2,
    row.jobSite.town,
    row.jobSite.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const timesheet = await getTimesheetSummary(workerId, now);
  return { record, siteAddress: address, timesheet };
}

/** The distinct sites a worker has attended (for the History site filter). */
export async function listWorkerAttendanceSites(
  workerId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.submission.findMany({
    where: { workerId },
    distinct: ['jobSiteId'],
    select: { jobSiteId: true, jobSite: { select: { name: true } } },
    orderBy: { checkedInAt: 'desc' },
  });
  return rows.map((r) => ({ id: r.jobSiteId, name: r.jobSite.name }));
}
