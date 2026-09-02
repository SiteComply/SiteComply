import Link from 'next/link';
import { cn } from '@/lib/cn';
import { WorkerIcon } from '@/components/worker/icons';
import { formatTimeUK, formatHoursMinutes } from '@/lib/datetime';
import type {
  AttendanceRecord,
  AttendanceState,
} from '@/services/attendance/attendanceHistoryService';

/** Small round status marker: complete (green), on-site (brand), incomplete (amber). */
export function AttendanceStatusIcon({ state }: { state: AttendanceState }) {
  const map = {
    complete: 'bg-safe-50 text-safe-700',
    onsite: 'bg-brand-50 text-brand-700',
    incomplete: 'bg-hivis-400/25 text-hivis-600',
  } as const;
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        map[state],
      )}
      aria-hidden="true"
    >
      <WorkerIcon
        name={state === 'complete' ? 'shield' : 'clock'}
        className="h-4 w-4"
      />
    </span>
  );
}

export function stateLabel(state: AttendanceState): string {
  return state === 'complete'
    ? 'Complete'
    : state === 'onsite'
      ? 'On site now'
      : 'Not checked out';
}

/** "08:12 - 16:45" (or "08:05 - —" when there's no check-out yet). */
export function inOut(record: AttendanceRecord): string {
  const inT = formatTimeUK(record.checkedInAt);
  const outT = record.checkedOutAt ? formatTimeUK(record.checkedOutAt) : '—';
  return `${inT} - ${outT}`;
}

export function hoursLabel(record: AttendanceRecord): string {
  return record.minutes != null ? formatHoursMinutes(record.minutes) : '—';
}

/** A tappable attendance record row (used on Overview + History). */
export function AttendanceRow({
  record,
  when,
}: {
  record: AttendanceRecord;
  /** Left-hand secondary label, e.g. "Today" / "Mon 14 Jul". */
  when: string;
}) {
  const incomplete = record.state === 'incomplete';
  return (
    <Link
      href={`/worker/attendance/${record.submissionId}`}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-surface p-3.5 shadow-card hover:bg-surface-sunken',
        incomplete ? 'border-hivis-500' : 'border-line',
      )}
    >
      <AttendanceStatusIcon state={record.state} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{record.siteName}</p>
        <p className="text-xs text-ink-subtle">{when}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-ink">
          {inOut(record)}
        </p>
        {/*
          The warning is set larger than the hours label it replaces: it is the
          only place a worker is told they left a shift open, and it was
          rendering smaller than the date beside it.

          It is ink, not hivis-600. Amber on white tops out at 2.56:1 — the
          whole hivis scale fails AA on this background — and the row already
          carries the warning in its amber border and icon, so the colour is
          not what makes this readable. ink is 17.9:1.
        */}
        <p
          className={cn(
            'font-semibold tabular-nums',
            incomplete ? 'text-sm text-ink' : 'text-xs text-ink-subtle',
          )}
        >
          {incomplete ? 'Not checked out' : hoursLabel(record)}
        </p>
      </div>
      <span className="shrink-0 text-ink-subtle">›</span>
    </Link>
  );
}

/** The "missing a check-out?" advisory banner. */
export function MissingCheckoutBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-hivis-500 bg-hivis-400/15 px-4 py-3 text-sm">
      <span className="mt-0.5 shrink-0 text-hivis-600">
        <WorkerIcon name="alert" className="h-4 w-4" />
      </span>
      <p className="text-ink">
        <span className="font-semibold">Missing a check-out?</span> If you
        forgot to check out, contact your site manager to correct your
        attendance — you can’t change recorded times yourself.
      </p>
    </div>
  );
}

/** A KPI tile for the weekly overview. */
export function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = 'brand',
}: {
  icon: 'clock' | 'grid' | 'shield' | 'clipboard';
  label: string;
  value: string;
  sub?: string;
  tone?: 'brand' | 'safe' | 'hivis' | 'teal';
}) {
  const toneMap = {
    brand: 'bg-brand-50 text-brand-700',
    safe: 'bg-safe-50 text-safe-700',
    hivis: 'bg-hivis-400/20 text-hivis-600',
    teal: 'bg-teal-50 text-teal-600',
  } as const;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            toneMap[tone],
          )}
        >
          <WorkerIcon name={icon} className="h-4 w-4" />
        </span>
        <span className="text-xs text-ink-subtle">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-ink-subtle">{sub}</p>}
    </div>
  );
}
