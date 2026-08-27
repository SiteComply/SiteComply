import { notFound } from 'next/navigation';
import Link from 'next/link';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { AttendanceShell } from '@/components/attendance/AttendanceShell';
import { stateLabel } from '@/components/attendance/AttendanceUI';
import { cn } from '@/lib/cn';
import {
  formatWeekdayLongUK,
  formatTimeUK,
  formatHoursMinutes,
} from '@/lib/datetime';
import {
  requireWorkerIdentity,
  getWorkerContext,
} from '@/services/workerDashboard/workerDashboardService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { getWorkerAttendanceDetail } from '@/services/attendance/attendanceHistoryService';

export const dynamic = 'force-dynamic';

const BANNER = {
  complete: 'bg-safe-600 text-white',
  onsite: 'bg-brand-600 text-white',
  incomplete: 'bg-hivis-500 text-ink',
} as const;

/** Worker → Attendance → Day detail (SC-010). */
export default async function AttendanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const worker = await requireWorkerIdentity();
  const context = await getWorkerContext();
  const now = new Date();

  const detail = await getWorkerAttendanceDetail(worker.id, params.id, now);
  if (!detail) notFound();
  const unread = context
    ? await countUnreadBulletinsForWorker(context.site.id, worker.id)
    : 0;

  const { record, siteAddress, timesheet } = detail;

  return (
    <AttendanceShell context={context} unreadBulletins={unread}>
      <div className="mb-3">
        <Link
          href="/worker/attendance/history"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Attendance
        </Link>
      </div>
      <WorkerPageHeader title="Day details" description={record.siteName} />

      {/* Status banner */}
      <div
        className={cn(
          'mb-4 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide',
          BANNER[record.state],
        )}
      >
        {record.state === 'incomplete'
          ? 'Incomplete — not checked out'
          : stateLabel(record.state)}
      </div>

      {/* Times */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <WorkerIcon name="clock" className="h-5 w-5 text-brand-700" />
          <p className="font-bold text-ink">
            {formatWeekdayLongUK(record.checkedInAt)}
          </p>
        </div>

        <TimeRow
          icon="clock"
          label="Check in"
          value={formatTimeUK(record.checkedInAt)}
          badge={record.locationVerified ? 'Location verified' : undefined}
        />
        <TimeRow
          icon="clock"
          label="Check out"
          value={
            record.checkedOutAt
              ? formatTimeUK(record.checkedOutAt)
              : 'Not checked out'
          }
          bad={!record.checkedOutAt}
        />

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-semibold text-ink">
            Total time on site
          </span>
          <span className="text-lg font-bold tabular-nums text-ink">
            {record.minutes != null ? formatHoursMinutes(record.minutes) : '—'}
          </span>
        </div>
      </div>

      {/* Reference + site */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0 text-brand-700">
            <WorkerIcon name="building" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{record.siteName}</p>
            {siteAddress && (
              <p className="text-sm text-ink-muted">{siteAddress}</p>
            )}
            <p className="mt-1 font-mono text-xs text-ink-subtle">
              Reference: {record.reference}
            </p>
          </div>
        </div>
      </div>

      {/* Timesheet summary */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-2 flex items-center gap-2">
          <WorkerIcon name="clock" className="h-4 w-4 text-brand-700" />
          <p className="text-sm font-bold text-ink">Timesheet summary</p>
        </div>
        <SummaryRow
          label="Total hours this week"
          value={formatHoursMinutes(timesheet.weekMinutes)}
        />
        <SummaryRow
          label="Total hours this month"
          value={formatHoursMinutes(timesheet.monthMinutes)}
        />
        <SummaryRow
          label="Average day this month"
          value={
            timesheet.monthDays
              ? formatHoursMinutes(timesheet.monthAverageDayMinutes)
              : '—'
          }
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
        <span className="mt-0.5 shrink-0 text-brand-700">
          <WorkerIcon name="user" className="h-4 w-4" />
        </span>
        <p className="text-ink">
          <span className="font-semibold">Need to update your times?</span>{' '}
          Contact your site manager if you believe your attendance needs
          correcting — times can’t be changed by workers.
        </p>
      </div>
    </AttendanceShell>
  );
}

function TimeRow({
  icon,
  label,
  value,
  badge,
  bad,
}: {
  icon: 'clock';
  label: string;
  value: string;
  badge?: string;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <WorkerIcon name={icon} className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm text-ink">{label}</span>
      <span
        className={cn(
          'text-base font-bold tabular-nums',
          bad ? 'text-hivis-600' : 'text-ink',
        )}
      >
        {value}
      </span>
      {badge && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
          <WorkerIcon name="shield" className="h-3 w-3" />
          {badge}
        </span>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-line py-2 first:border-t-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}
