import Link from 'next/link';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { AttendanceShell } from '@/components/attendance/AttendanceShell';
import {
  AttendanceStatusIcon,
  inOut,
  hoursLabel,
} from '@/components/attendance/AttendanceUI';
import {
  formatDateUK,
  formatWeekdayShortUK,
  formatHoursMinutes,
} from '@/lib/datetime';
import {
  requireWorkerIdentity,
  getWorkerContext,
} from '@/services/workerDashboard/workerDashboardService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  listWorkerAttendance,
  listWorkerAttendanceSites,
  summarise,
  groupByWeek,
  currentMonthRange,
  currentWeekRange,
} from '@/services/attendance/attendanceHistoryService';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Worker → Attendance History (SC-010). Filter by site + date range; records
 * grouped by week with weekly totals; incomplete check-outs clearly flagged.
 */
export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: { site?: string; from?: string; to?: string; range?: string };
}) {
  const worker = await requireWorkerIdentity();
  const context = await getWorkerContext();
  const now = new Date();

  // Resolve the date range: an explicit from/to, else a preset (week/month).
  const preset = searchParams.range === 'week' ? 'week' : 'month';
  const base =
    preset === 'week' ? currentWeekRange(now) : currentMonthRange(now);
  const from =
    searchParams.from && ISO.test(searchParams.from)
      ? searchParams.from
      : base.from;
  const to =
    searchParams.to && ISO.test(searchParams.to) ? searchParams.to : base.to;
  const site = searchParams.site || '';

  const [sites, records] = await Promise.all([
    listWorkerAttendanceSites(worker.id),
    listWorkerAttendance(
      worker.id,
      { siteId: site || undefined, from, to },
      now,
    ),
  ]);
  const unread = context
    ? await countUnreadBulletinsForWorker(context.site.id, worker.id)
    : 0;

  const s = summarise(records);
  const weeks = groupByWeek(records);

  return (
    <AttendanceShell context={context} unreadBulletins={unread}>
      <WorkerPageHeader
        title="Attendance history"
        description="Your recorded site attendance."
      />

      {/* Tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sunken p-1">
        <Link
          href="/worker/attendance"
          className="rounded-lg px-3 py-2 text-center text-sm font-semibold text-ink-muted hover:bg-surface"
        >
          Overview
        </Link>
        <span className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white">
          History
        </span>
      </div>

      {/* Filters — no-JS GET form */}
      <form
        method="get"
        className="mb-4 space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card"
      >
        <div className="flex gap-2">
          <Link
            href="/worker/attendance/history?range=week"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-center text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            This week
          </Link>
          <Link
            href="/worker/attendance/history?range=month"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-center text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            This month
          </Link>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink">Site</span>
          <select
            name="site"
            defaultValue={site}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All sites</option>
            {sites.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Apply filters
        </button>
      </form>

      {/* Period summary */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-brand-50 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-ink">
            {formatDateUK(from + 'T00:00:00Z')} –{' '}
            {formatDateUK(to + 'T00:00:00Z')}
          </p>
          <p className="text-xs text-ink-muted">
            {s.daysOnSite} day{s.daysOnSite === 1 ? '' : 's'} on site ·{' '}
            {s.incompleteCount > 0 && (
              <span className="font-semibold text-hivis-600">
                {s.incompleteCount} missing check-out
                {s.incompleteCount === 1 ? '' : 's'}
              </span>
            )}
            {s.incompleteCount === 0 && 'all checked out'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-brand-700">
            {formatHoursMinutes(s.totalMinutes)}
          </p>
          <p className="text-xs text-ink-subtle">total hours</p>
        </div>
      </div>

      {weeks.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken px-4 py-6 text-center text-sm text-ink-subtle">
          No attendance in this period.
        </p>
      ) : (
        <div className="space-y-5">
          {weeks.map((wk) => (
            <section key={wk.weekCommencing}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">
                  Week commencing{' '}
                  {formatDateUK(wk.weekCommencing + 'T00:00:00Z')}
                </h2>
                <span className="text-xs font-semibold tabular-nums text-ink-subtle">
                  Total: {formatHoursMinutes(wk.totalMinutes)}
                </span>
              </div>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {wk.records.map((r) => (
                  <li
                    key={r.submissionId}
                    className="border-b border-line last:border-b-0"
                  >
                    <Link
                      href={`/worker/attendance/${r.submissionId}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken"
                    >
                      <AttendanceStatusIcon state={r.state} />
                      <div className="w-24 shrink-0">
                        <p className="text-sm font-semibold text-ink">
                          {formatWeekdayShortUK(r.checkedInAt)}
                        </p>
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                        {r.siteName}
                      </p>
                      <div className="shrink-0 text-right">
                        <p className="text-sm tabular-nums text-ink">
                          {inOut(r)}
                        </p>
                        <p
                          className={
                            r.state === 'incomplete'
                              ? 'text-xs font-semibold text-hivis-600'
                              : 'text-xs tabular-nums text-ink-subtle'
                          }
                        >
                          {r.state === 'incomplete' ? 'Not out' : hoursLabel(r)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AttendanceShell>
  );
}
