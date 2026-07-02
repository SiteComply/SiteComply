import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  ReportHeader,
  ReportFilterBar,
  KpiCards,
} from '@/components/platform/ReportView';
import { formatDateTimeUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import {
  canRunReport,
  canExportReport,
  isAggregateOnly,
} from '@/services/reports/reportAccess';
import { parseReportFilters, reportFiltersQuery } from '@/services/reports/reportFilters';
import {
  getAttendanceSummary,
  getAttendanceRows,
} from '@/services/reports/attendanceReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('attendance')!;
const DISPLAY_LIMIT = 100;

/**
 * Site Attendance report. Scoped to the viewer's assigned sites (Directors see
 * all). Clients get aggregate figures only — no worker-level rows. Export is
 * gated by the reports-export permission.
 */
export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'reports');
  if (!canRunReport(viewer, REPORT)) redirect('/platform/dashboard/reports');

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const many = (v: string | string[] | undefined) =>
    v == null ? [] : Array.isArray(v) ? v : [v];
  const filters = parseReportFilters(
    { from: one(searchParams.from), to: one(searchParams.to), sites: many(searchParams.sites) },
    viewer,
  );

  const aggregate = isAggregateOnly(viewer, REPORT);
  const canExport = canExportReport(viewer, REPORT);
  const summary = await getAttendanceSummary(filters.siteIds, filters.range);
  const rows = aggregate
    ? []
    : await getAttendanceRows(filters.siteIds, filters.range, DISPLAY_LIMIT);

  return (
    <PlatformShell>
      <ReportHeader
        title="Site Attendance"
        description={`Check-ins from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/attendance/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/attendance"
      />

      <KpiCards
        items={[
          { label: 'Check-ins', value: summary.total },
          { label: 'Unique workers', value: summary.uniqueWorkers },
          { label: 'Still on site', value: summary.onSite, sub: 'no check-out recorded' },
          { label: 'Checked out', value: summary.checkedOut },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">By site</h2>
        </div>
        {summary.bySite.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No check-ins in this period for your sites.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="px-5 py-2 font-medium">Site</th>
                <th className="px-5 py-2 text-right font-medium">Check-ins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.bySite.map((s) => (
                <tr key={s.name}>
                  <td className="px-5 py-2 text-ink">{s.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {aggregate ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-subtle">
          Aggregate view — worker-level detail and export are not available for
          your role.
        </p>
      ) : (
        <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold text-ink">Check-in records</h2>
            {summary.total > rows.length && (
              <span className="text-xs text-ink-subtle">
                Showing {rows.length} of {summary.total} — export CSV for all
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No check-ins in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2 font-medium">Worker</th>
                    <th className="px-5 py-2 font-medium">Company</th>
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 font-medium">Checked in</th>
                    <th className="px-5 py-2 font-medium">Checked out</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium text-ink">{r.workerName}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.workerCompany}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.siteName}</td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {formatDateTimeUK(r.checkedInAt)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {r.checkedOutAt ? formatDateTimeUK(r.checkedOutAt) : '—'}
                      </td>
                      <td className="px-5 py-2">
                        <span
                          className={
                            r.status === 'COMPLIANT'
                              ? 'font-semibold text-safe-700'
                              : 'font-semibold text-hivis-600'
                          }
                        >
                          {r.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </PlatformShell>
  );
}
