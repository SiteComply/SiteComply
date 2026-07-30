import { SchedulerTrigger, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  ensureOccurrences,
  londonDateStr,
  addDays,
} from '@/services/compliance/occurrenceGenerator';
import { recordEscalations } from '@/services/compliance/complianceNotifications';

/**
 * SC-020 Phase 4 — the scheduled generation run.
 *
 * This is the SAME generator and escalation recorder the calendar already calls
 * on read; Phase 1 was built as "one code path, two invokers" precisely so this
 * phase adds a trigger rather than a second implementation. Both are idempotent
 * (unique(scheduleId, dueAt) for occurrences, the escalatedAt null-claim for
 * escalations), so the timer and a simultaneous calendar load cannot conflict.
 *
 * Lazy generation on read is deliberately RETAINED as a fallback. A compliance
 * scheduler that silently stops generating is the worst failure available — the
 * calendar would look calm while inspections went unraised. The timer makes
 * reminders punctual; the fallback makes correctness unconditional.
 *
 * This runs with NO viewer, so it deliberately operates across every active site.
 * That is safe because it returns only counts — never site or personal data — and
 * the endpoint that calls it is guarded by a shared secret.
 */

/** How far ahead the timer generates. Bounded so a daily schedule can't explode. */
export const GENERATION_HORIZON_DAYS = 60;

export interface SchedulerRunResult {
  runId: string;
  sitesConsidered: number;
  occurrencesCreated: number;
  escalationsRecorded: number;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export async function runScheduledGeneration(
  trigger: SchedulerTrigger = SchedulerTrigger.TIMER,
): Promise<SchedulerRunResult> {
  const started = Date.now();
  const run = await prisma.schedulerRun.create({
    data: { trigger },
    select: { id: true },
  });

  try {
    const sites = await prisma.jobSite.findMany({
      where: { status: SiteStatus.ACTIVE },
      select: { id: true },
    });
    const siteIds = sites.map((s) => s.id);

    const today = londonDateStr(new Date());
    // A backward window as well as forward: an activity that came due while the
    // timer was down still needs to exist before it can be escalated.
    const from = addDays(today, -7);
    const to = addDays(today, GENERATION_HORIZON_DAYS);

    const generated = await ensureOccurrences(siteIds, from, to);
    const escalated = await recordEscalations(siteIds);

    const result: SchedulerRunResult = {
      runId: run.id,
      sitesConsidered: siteIds.length,
      occurrencesCreated: generated.created,
      escalationsRecorded: escalated.escalated,
      ok: true,
      durationMs: Date.now() - started,
    };

    await prisma.schedulerRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        sitesConsidered: result.sitesConsidered,
        occurrencesCreated: result.occurrencesCreated,
        escalationsRecorded: result.escalationsRecorded,
        ok: true,
      },
    });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    // A failed run is RECORDED, not swallowed. An unrecorded failure would look
    // identical to a healthy quiet hour on the calendar's status line.
    await prisma.schedulerRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: message.slice(0, 500) },
    });
    return {
      runId: run.id,
      sitesConsidered: 0,
      occurrencesCreated: 0,
      escalationsRecorded: 0,
      ok: false,
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

export interface SchedulerHealth {
  lastRunAt: Date | null;
  lastOk: boolean | null;
  lastError: string | null;
  occurrencesCreated: number | null;
  escalationsRecorded: number | null;
  /** True when no successful triggered run in the last 3 hours (hourly cadence). */
  stale: boolean;
  /** True when the timer has never run — a different problem from "stale". */
  neverRun: boolean;
}

/** Hourly cadence, so three hours without a run means something is wrong. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * The calendar's "last generated" status. Distinguishes never-run from stale from
 * healthy, because "the timer was never set up" and "the timer has died" need
 * different responses.
 */
export async function getSchedulerHealth(): Promise<SchedulerHealth> {
  const last = await prisma.schedulerRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
  });

  if (!last) {
    return {
      lastRunAt: null,
      lastOk: null,
      lastError: null,
      occurrencesCreated: null,
      escalationsRecorded: null,
      stale: false,
      neverRun: true,
    };
  }

  return {
    lastRunAt: last.startedAt,
    lastOk: last.ok,
    lastError: last.error,
    occurrencesCreated: last.occurrencesCreated,
    escalationsRecorded: last.escalationsRecorded,
    stale: Date.now() - last.startedAt.getTime() > STALE_AFTER_MS,
    neverRun: false,
  };
}
