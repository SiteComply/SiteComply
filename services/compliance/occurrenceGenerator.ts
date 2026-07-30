import { ScheduleFrequency } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { zonedMidnightToUtc } from '@/lib/datetime';

/**
 * SC-020 Phase 1 — occurrence generation.
 *
 * Three properties matter more here than anywhere else in the product, because a
 * duplicated or missing statutory inspection is a compliance failure rather than
 * a cosmetic bug:
 *
 * 1. IDEMPOTENT. Writes go through createMany + skipDuplicates against
 *    @@unique([scheduleId, dueAt]). Running twice, or concurrently from two
 *    requests, cannot double-generate. The database enforces it, not this code.
 * 2. BOUNDED. Only ever the requested window (plus the caller's lookahead), so a
 *    five-year daily schedule never tries to write two thousand rows in one page
 *    load.
 * 3. ACTIVATION-FORWARD. Nothing is generated before `activatedAt`, so switching
 *    on a schedule whose start date is historic never backfills months of
 *    "missed" inspections that nobody could have done.
 *
 * Called LAZILY from the calendar and Upcoming panel today; Phase 4's scheduled
 * trigger will call this same function. One code path, two invokers.
 */

/** yyyy-mm-dd in Europe/London for a given instant. */
export function londonDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** ISO weekday (1 = Monday) for a yyyy-mm-dd date string. */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const js = d.getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr: string, toStr: string): number {
  const a = new Date(`${fromStr}T12:00:00Z`).getTime();
  const b = new Date(`${toStr}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Days in the month containing a yyyy-mm-dd date. */
function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/**
 * The local due dates a schedule implies within [fromStr, toStr] inclusive.
 * Pure and exported so the frequency rules can be tested without a database.
 */
export function dueDatesInWindow(
  schedule: {
    frequency: ScheduleFrequency;
    intervalDays: number | null;
    weekdays: number[];
    dayOfMonth: number | null;
    startLocal: string;
  },
  fromStr: string,
  toStr: string,
): string[] {
  if (daysBetween(fromStr, toStr) < 0) return [];
  const out: string[] = [];

  switch (schedule.frequency) {
    case ScheduleFrequency.DAILY: {
      // An empty weekday list means every day; a populated one limits the days
      // (so "daily, weekdays only" needs no separate frequency).
      for (let d = fromStr; daysBetween(d, toStr) >= 0; d = addDays(d, 1)) {
        if (
          schedule.weekdays.length === 0 ||
          schedule.weekdays.includes(isoWeekday(d))
        ) {
          out.push(d);
        }
      }
      break;
    }
    case ScheduleFrequency.WEEKLY: {
      const days =
        schedule.weekdays.length > 0
          ? schedule.weekdays
          : [isoWeekday(schedule.startLocal)];
      for (let d = fromStr; daysBetween(d, toStr) >= 0; d = addDays(d, 1)) {
        if (days.includes(isoWeekday(d))) out.push(d);
      }
      break;
    }
    case ScheduleFrequency.MONTHLY: {
      const target =
        schedule.dayOfMonth ?? Number(schedule.startLocal.slice(8, 10));
      for (let d = fromStr; daysBetween(d, toStr) >= 0; d = addDays(d, 1)) {
        // Clamp to the month's length: day 31 lands on the 28th/29th in
        // February rather than skipping the month entirely.
        const dim = daysInMonth(d);
        const effective = Math.min(target, dim);
        if (Number(d.slice(8, 10)) === effective) out.push(d);
      }
      break;
    }
    case ScheduleFrequency.CUSTOM: {
      const step = Math.max(1, schedule.intervalDays ?? 1);
      // Anchored on the start date so the cadence is stable regardless of which
      // window happens to be requested.
      const offset = daysBetween(schedule.startLocal, fromStr);
      const firstAligned =
        offset <= 0
          ? schedule.startLocal
          : addDays(fromStr, (step - (offset % step)) % step);
      for (
        let d = firstAligned;
        daysBetween(d, toStr) >= 0;
        d = addDays(d, step)
      ) {
        if (daysBetween(fromStr, d) >= 0) out.push(d);
      }
      break;
    }
  }
  return out;
}

export interface GenerationResult {
  created: number;
  schedulesConsidered: number;
}

/**
 * Ensure occurrences exist for the given sites across a local date window.
 * Safe to call on every page load.
 */
export async function ensureOccurrences(
  siteIds: string[],
  fromStr: string,
  toStr: string,
): Promise<GenerationResult> {
  if (siteIds.length === 0) return { created: 0, schedulesConsidered: 0 };

  const schedules = await prisma.complianceSchedule.findMany({
    where: {
      jobSiteId: { in: siteIds },
      active: true,
      startDate: { lte: new Date(`${toStr}T23:59:59.999Z`) },
      OR: [
        { endDate: null },
        { endDate: { gte: new Date(`${fromStr}T00:00:00Z`) } },
      ],
    },
  });

  let created = 0;
  for (const s of schedules) {
    const startLocal = londonDateStr(s.startDate);
    const activatedLocal = londonDateStr(s.activatedAt);
    // Activation-forward: never before the later of start and activation.
    const lowerBound =
      daysBetween(startLocal, activatedLocal) > 0 ? activatedLocal : startLocal;
    const windowFrom =
      daysBetween(fromStr, lowerBound) > 0 ? lowerBound : fromStr;
    const windowTo = s.endDate
      ? (() => {
          const endLocal = londonDateStr(s.endDate);
          return daysBetween(endLocal, toStr) > 0 ? endLocal : toStr;
        })()
      : toStr;

    const dates = dueDatesInWindow(
      {
        frequency: s.frequency,
        intervalDays: s.intervalDays,
        weekdays: s.weekdays,
        dayOfMonth: s.dayOfMonth,
        startLocal,
      },
      windowFrom,
      windowTo,
    );
    if (dates.length === 0) continue;

    const rows = dates.map((dateLocal) => ({
      scheduleId: s.id,
      jobSiteId: s.jobSiteId,
      // The local wall-clock time is converted to a UTC instant, so an 07:30
      // activity stays 07:30 local across the DST boundaries.
      dueAt: localDateTimeToUtc(dateLocal, s.timeOfDay),
      dueDateLocal: dateLocal,
      timeOfDay: s.timeOfDay,
      assigneeKind: s.assigneeKind,
      assignedPlatformUserId: s.assignedPlatformUserId,
      assignedWorkerId: s.assignedWorkerId,
      assignedRole: s.assignedRole,
    }));

    const res = await prisma.complianceOccurrence.createMany({
      data: rows,
      skipDuplicates: true,
    });
    created += res.count;
  }

  return { created, schedulesConsidered: schedules.length };
}

/**
 * Combine a Europe/London date and "HH:MM" into a UTC instant, reusing the
 * project's existing zoned-midnight helper so DST is handled the same way as
 * attendance and check-in times.
 */
export function localDateTimeToUtc(dateStr: string, timeOfDay: string): Date {
  const midnightUtc = zonedMidnightToUtc(dateStr);
  const [h, m] = timeOfDay.split(':').map(Number);
  return new Date(midnightUtc.getTime() + (h! * 60 + m!) * 60000);
}
