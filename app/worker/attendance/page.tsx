import Link from 'next/link';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { AttendanceShell } from '@/components/attendance/AttendanceShell';
import {
  KpiTile,
  AttendanceRow,
  MissingCheckoutBanner,
} from '@/components/attendance/AttendanceUI';
import { formatDateUK, formatHoursMinutes } from '@/lib/datetime';
import {
  requireWorkerIdentity,
  getWorkerContext,
} from '@/services/workerDashboard/workerDashboardService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  listWorkerAttendance,
  summarise,
  currentWeekRange,
  workingDaysInRange,
} from '@/services/attendance/attendanceHistoryService';

export const dynamic = 'force-dynamic';

/**
 * Worker → My Attendance, Overview (SC-010). This week's timesheet at a glance
 * plus recent attendance. Accessible whether or not the worker is checked in.
 */
export default async function WorkerAttendancePage() {
  const worker = await requireWorkerIdentity();
  const context = await getWorkerContext();
  const now = new Date();

  const week = currentWeekRange(now);
  const [weekRecords, recent, unread] = await Promise.all([
    listWorkerAttendance(worker.id, week, now),
    listWorkerAttendance(worker.id, {}, now),
    context
      ? countUnreadBulletinsForWorker(context.site.id, worker.id)
      : Promise.resolve(0),
  ]);
  const s = summarise(weekRecords);
  const workingDays = workingDaysInRange(week.from, week.to);
  const recentTop = recent.slice(0, 5);
  const anyIncomplete = recent.some((r) => r.state === 'incomplete');

  return (
    <AttendanceShell context={context} unreadBulletins={unread}>
      <WorkerPageHeader
        title="My attendance"
        description="Your site check-ins, hours and timesheet."
      />

      {/* Tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sunken p-1">
        <span className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white">
          Overview
        </span>
        <Link
          href="/worker/attendance/history"
          className="rounded-lg px-3 py-2 text-center text-sm font-semibold text-ink-muted hover:bg-surface"
        >
          History
        </Link>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">This week</h2>
        <span className="text-xs text-ink-subtle">
          {formatDateUK(week.from + 'T00:00:00Z')} –{' '}
          {formatDateUK(week.to + 'T00:00:00Z')}
        </span>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <KpiTile
          icon="grid"
          tone="safe"
          label="Days on site"
          value={String(s.daysOnSite)}
          sub={`of ${workingDays} working days`}
        />
        <KpiTile
          icon="clock"
          tone="brand"
          label="Total hours"
          value={formatHoursMinutes(s.totalMinutes)}
          sub="this week"
        />
        <KpiTile
          icon="clock"
          tone="hivis"
          label="Average day"
          value={s.daysOnSite ? formatHoursMinutes(s.averageDayMinutes) : '—'}
          sub="per day"
        />
        <KpiTile
          icon="shield"
          tone="teal"
          label="Complete days"
          value={`${s.completePct}%`}
          sub="checked in & out"
        />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">Recent attendance</h2>
        <Link
          href="/worker/attendance/history"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          View all
        </Link>
      </div>
      {recentTop.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken px-4 py-6 text-center text-sm text-ink-subtle">
          No attendance recorded yet. Your check-ins will appear here.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {recentTop.map((r) => (
            <li key={r.submissionId}>
              <AttendanceRow record={r} when={relativeLabel(r.dateStr, now)} />
            </li>
          ))}
        </ul>
      )}

      {anyIncomplete && (
        <div className="mt-4">
          <MissingCheckoutBanner />
        </div>
      )}
    </AttendanceShell>
  );
}

/** "Today" / "Yesterday" / a date, for the row's secondary label. */
function relativeLabel(dateStr: string, now: Date): string {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (dateStr === todayStr) return 'Today';
  const y = new Date(
    Date.UTC(...(todayStr.split('-').map(Number) as [number, number, number])),
  );
  y.setUTCDate(y.getUTCDate() - 1);
  if (dateStr === y.toISOString().slice(0, 10)) return 'Yesterday';
  return formatDateUK(dateStr + 'T00:00:00Z');
}
