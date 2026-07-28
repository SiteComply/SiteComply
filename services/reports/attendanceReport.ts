import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Site Attendance report data. Every query is scoped to the caller-supplied
 * `siteIds` (already intersected with the viewer's Assigned Sites) and the
 * `checkedInAt` date range. `getAttendanceRows` returns worker-level detail
 * (used by non-Client views and the CSV export); `getAttendanceSummary` returns
 * aggregate-only figures (safe for Client views).
 */

type Range = { gte?: Date; lt?: Date };

function where(siteIds: string[], range: Range) {
  return {
    jobSiteId: { in: siteIds },
    ...(range.gte || range.lt ? { checkedInAt: range } : {}),
  };
}

export interface AttendanceRow {
  id: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  status: SubmissionStatus;
  /** SC-006: true when this check-in reused a still-valid earlier induction. */
  inductionReused: boolean;
  // SC-007: GPS check-in location outcome.
  locationVerified: boolean;
  locationOverridden: boolean;
  gpsUnavailable: boolean;
  checkInDistanceM: number | null;
  workerName: string;
  workerCompany: string;
  siteName: string;
  siteRef: string;
}

/**
 * Total minutes on site for a row (SC-010): checkedOut − checkedIn, or null when
 * the worker hasn't checked out. GROSS time (breaks aren't tracked in v1).
 */
export function attendanceTotalMinutes(r: {
  checkedInAt: Date;
  checkedOutAt: Date | null;
}): number | null {
  if (!r.checkedOutAt) return null;
  return Math.max(
    0,
    Math.round((r.checkedOutAt.getTime() - r.checkedInAt.getTime()) / 60000),
  );
}

/** Human label for the location outcome of a check-in row (SC-007). */
export function attendanceLocationLabel(r: {
  locationVerified: boolean;
  locationOverridden: boolean;
  gpsUnavailable: boolean;
  checkInDistanceM: number | null;
}): string {
  if (r.locationVerified) return 'Verified';
  if (r.locationOverridden) return 'Override';
  if (r.gpsUnavailable) return 'No GPS';
  if (r.checkInDistanceM != null) return 'Off-site';
  return '—';
}

/** Worker-level check-in rows (newest first). `limit` caps for on-screen tables. */
export async function getAttendanceRows(
  siteIds: string[],
  range: Range,
  limit?: number,
): Promise<AttendanceRow[]> {
  if (!siteIds.length) return [];
  const subs = await prisma.submission.findMany({
    where: where(siteIds, range),
    orderBy: { checkedInAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      checkedInAt: true,
      checkedOutAt: true,
      status: true,
      inductionReused: true,
      locationVerified: true,
      locationOverridden: true,
      gpsUnavailable: true,
      checkInDistanceM: true,
      worker: { select: { fullName: true, company: true } },
      jobSite: { select: { name: true, jobReference: true } },
    },
  });
  return subs.map((s) => ({
    id: s.id,
    checkedInAt: s.checkedInAt,
    checkedOutAt: s.checkedOutAt,
    status: s.status,
    inductionReused: s.inductionReused,
    locationVerified: s.locationVerified,
    locationOverridden: s.locationOverridden,
    gpsUnavailable: s.gpsUnavailable,
    checkInDistanceM: s.checkInDistanceM,
    workerName: s.worker.fullName,
    workerCompany: s.worker.company,
    siteName: s.jobSite.name,
    siteRef: s.jobSite.jobReference,
  }));
}

export interface AttendanceSummary {
  total: number;
  onSite: number; // no check-out recorded
  checkedOut: number;
  uniqueWorkers: number;
  bySite: { name: string; count: number }[];
}

/** Aggregate figures only — no worker identities (safe for Client). */
export async function getAttendanceSummary(
  siteIds: string[],
  range: Range,
): Promise<AttendanceSummary> {
  const empty: AttendanceSummary = {
    total: 0,
    onSite: 0,
    checkedOut: 0,
    uniqueWorkers: 0,
    bySite: [],
  };
  if (!siteIds.length) return empty;

  const subs = await prisma.submission.findMany({
    where: where(siteIds, range),
    select: {
      workerId: true,
      checkedOutAt: true,
      jobSite: { select: { name: true } },
    },
  });

  const total = subs.length;
  const onSite = subs.filter((s) => !s.checkedOutAt).length;
  const workers = new Set(subs.map((s) => s.workerId));
  const bySiteMap = new Map<string, number>();
  for (const s of subs) {
    bySiteMap.set(s.jobSite.name, (bySiteMap.get(s.jobSite.name) ?? 0) + 1);
  }
  const bySite = [...bySiteMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    onSite,
    checkedOut: total - onSite,
    uniqueWorkers: workers.size,
    bySite,
  };
}
