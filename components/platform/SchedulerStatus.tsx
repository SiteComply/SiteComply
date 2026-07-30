import { formatDateTimeUK } from '@/lib/datetime';
import type { SchedulerHealth } from '@/services/compliance/schedulerRunner';

/**
 * SC-020 Phase 4 — the calendar's "last generated" line.
 *
 * Phase 1 promised visible staleness rather than silent staleness; this delivers
 * it. Three distinct states, because they need different responses: never run
 * (the timer was never wired up), stale (it has died), and healthy. A dead
 * scheduler must never look like a quiet week.
 */
export function SchedulerStatus({ health }: { health: SchedulerHealth }) {
  if (health.neverRun) {
    return (
      <p className="text-xs text-ink-subtle">
        Scheduled generation has not run yet. Activities are still generated
        when a calendar period is viewed, so this calendar is up to date.
      </p>
    );
  }

  const when = health.lastRunAt
    ? formatDateTimeUK(health.lastRunAt)
    : 'unknown';

  // A failure states THAT it failed, never WHY. `health.lastError` is a raw
  // internal error (Prisma messages carry table, column and host detail) and
  // this line is visible to everyone with audits:view, which includes external
  // Auditor and H&S Consultant users. The reason is recorded on SchedulerRun for
  // whoever investigates — see scripts/sc020p4_status.ts.
  if (!health.lastOk) {
    return (
      <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-1.5 text-xs font-medium text-danger-700">
        Scheduled generation failed at {when}. Activities are still generated
        when a calendar period is viewed, so this calendar is up to date.
        Contact support if this persists.
      </p>
    );
  }

  if (health.stale) {
    return (
      <p className="rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-3 py-1.5 text-xs font-medium text-ink-muted">
        Last scheduled generation {when} — longer ago than expected. Reminders
        may be delayed; the calendar itself stays up to date on view.
      </p>
    );
  }

  return (
    <p className="text-xs text-ink-subtle">
      Last generated {when} · {health.occurrencesCreated ?? 0} activities
      created, {health.escalationsRecorded ?? 0} escalations recorded.
    </p>
  );
}
