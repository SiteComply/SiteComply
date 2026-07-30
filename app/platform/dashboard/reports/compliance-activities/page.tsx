import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  ReportHeader,
  ReportFilterBar,
  KpiCards,
} from '@/components/platform/ReportView';
import { formatDateUK } from '@/lib/datetime';
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
import {
  parseReportFilters,
  reportFiltersQuery,
} from '@/services/reports/reportFilters';
import {
  getComplianceKpis,
  getSiteComplianceScores,
  getComplianceTrend,
  getComplianceActivityRows,
  GENERATION_CAVEAT,
  TREND_WEEKS,
} from '@/services/reports/complianceActivityReport';
import {
  OCCURRENCE_STATUS_LABEL,
  type OccurrenceStatusValue,
} from '@/services/compliance/complianceConstants';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('compliance-activities')!;
const DISPLAY_LIMIT = 100;

/** "—" rather than 0% when nothing has come due: they mean different things. */
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/**
 * SC-020 Phase 3 — Compliance Activities report.
 *
 * Detailed reporting lives here in the Reports module (inheriting its export
 * policy and RBAC); a summary KPI strip sits on the Compliance Calendar, which
 * remains the primary experience.
 */
export default async function ComplianceActivitiesReportPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'reports');
  if (!canRunReport(viewer, REPORT)) redirect('/platform/dashboard/reports');

  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const many = (v: string | string[] | undefined) =>
    v == null ? [] : Array.isArray(v) ? v : [v];
  const filters = parseReportFilters(
    {
      from: one(searchParams.from),
      to: one(searchParams.to),
      sites: many(searchParams.sites),
    },
    viewer,
  );

  const aggregate = isAggregateOnly(viewer, REPORT);
  const canExport = canExportReport(viewer, REPORT);

  const [kpis, siteScores, trend, allRows] = await Promise.all([
    getComplianceKpis(filters.siteIds, filters.range),
    getSiteComplianceScores(filters.siteIds, filters.range),
    getComplianceTrend(filters.siteIds),
    aggregate
      ? Promise.resolve([])
      : getComplianceActivityRows(filters.siteIds, filters.range),
  ]);
  const rows = allRows.slice(0, DISPLAY_LIMIT);
  const noData = kpis.due === 0 && kpis.upcoming === 0;

  return (
    <PlatformShell>
      <ReportHeader
        title="Compliance Activities"
        description={`Scheduled compliance activities from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/compliance-activities/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        filters={filters}
        viewer={viewer}
        action="/platform/dashboard/reports/compliance-activities"
      />

      {noData ? (
        <p className="mt-4 rounded-xl border border-line bg-surface p-6 text-sm text-ink-subtle shadow-card">
          No compliance activities in this period yet. Schedules generate
          activities from their start date onward — create one on the{' '}
          <a
            href="/platform/dashboard/compliance-calendar"
            className="font-semibold text-brand-700 hover:underline"
          >
            Compliance Calendar
          </a>
          .
        </p>
      ) : (
        <>
          <KpiCards
            items={[
              { label: 'Completion rate', value: pct(kpis.completionRate) },
              { label: 'Outstanding', value: String(kpis.outstanding) },
              { label: 'Overdue', value: String(kpis.overdue) },
              { label: 'Escalated', value: String(kpis.escalated) },
              { label: 'Upcoming', value: String(kpis.upcoming) },
              {
                label: 'Active schedules',
                value: String(kpis.activeSchedules),
              },
            ]}
          />

          {/* Site compliance scores — completion rate only, with the SC-014 audit
              score shown SEPARATELY so a site that completes everything while
              failing it cannot hide behind one blended number. */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold text-ink">
              Site compliance scores
            </h2>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2.5 font-medium">Site</th>
                    <th className="px-5 py-2.5 text-right font-medium">Due</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Completed
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Overdue
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Escalated
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Compliance score
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Avg audit score
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {siteScores.map((s) => (
                    <tr key={s.siteId} className="hover:bg-brand-50/30">
                      <td className="px-5 py-3 font-medium text-ink">
                        {s.siteName}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                        {s.due}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                        {s.completed}
                      </td>
                      <td
                        className={`px-5 py-3 text-right tabular-nums ${s.overdue > 0 ? 'font-semibold text-danger-600' : 'text-ink-muted'}`}
                      >
                        {s.overdue}
                      </td>
                      <td
                        className={`px-5 py-3 text-right tabular-nums ${s.escalated > 0 ? 'font-semibold text-danger-700' : 'text-ink-muted'}`}
                      >
                        {s.escalated}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                        {pct(s.completionRate)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                        {s.averageAuditScore === null
                          ? '—'
                          : `${s.averageAuditScore}% (${s.auditsScored})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              Compliance score is the completion rate. The average audit score
              is shown separately and never blended in — a site can complete
              every inspection and still be failing them.
            </p>
          </section>

          {/* 12-week trend as a plain bar series: it is a small time series read
              at a glance, and a text table beside it would be read by nobody. */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold text-ink">
              Completion trend — last {TREND_WEEKS} weeks
            </h2>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex min-w-[36rem] items-end gap-2">
                {trend.map((b) => (
                  <div
                    key={b.weekCommencing}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <span className="text-[11px] tabular-nums text-ink-subtle">
                      {b.completionRate === null ? '' : `${b.completionRate}%`}
                    </span>
                    <div
                      className="w-full rounded-t bg-surface-sunken"
                      style={{ height: 96 }}
                      title={`${b.due} due, ${b.completed} completed, ${b.overdue} overdue`}
                    >
                      <div
                        className="w-full rounded-t bg-brand-500"
                        style={{
                          height: `${b.completionRate ?? 0}%`,
                          marginTop: `${100 - (b.completionRate ?? 0)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-ink-subtle">
                      {b.weekCommencing.slice(8, 10)}/
                      {b.weekCommencing.slice(5, 7)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              Weeks commencing Monday. A week with nothing due shows no
              percentage rather than 0%.
            </p>
          </section>

          {aggregate ? (
            <p className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
              Aggregate view — activity-level detail and export are not
              available for your role.
            </p>
          ) : (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold text-ink">Activities</h2>
              {allRows.length > DISPLAY_LIMIT && (
                <p className="mb-1.5 text-xs text-ink-subtle">
                  Showing {rows.length} of {allRows.length} — export CSV for
                  all.
                </p>
              )}
              <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-subtle">
                      <th className="px-5 py-2.5 font-medium">Activity</th>
                      <th className="px-5 py-2.5 font-medium">Site</th>
                      <th className="px-5 py-2.5 font-medium">Due</th>
                      <th className="px-5 py-2.5 font-medium">Assigned to</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                      <th className="px-5 py-2.5 text-right font-medium">
                        Audit score
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-brand-50/30">
                        <td className="px-5 py-3 font-medium text-ink">
                          {r.activity}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {r.siteName}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {formatDateUK(`${r.dueDateLocal}T12:00:00Z`)}{' '}
                          {r.timeOfDay}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {r.assignee}
                        </td>
                        <td className="px-5 py-3">
                          {r.escalatedAt ? (
                            <span className="inline-flex rounded-full bg-danger-600 px-2 py-0.5 text-xs font-semibold text-white">
                              Escalated
                            </span>
                          ) : r.overdue ? (
                            <span className="inline-flex rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700">
                              Overdue
                            </span>
                          ) : (
                            <span className="text-ink-muted">
                              {OCCURRENCE_STATUS_LABEL[
                                r.status as OccurrenceStatusValue
                              ] ?? r.status}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                          {r.auditScore === null ? '—' : `${r.auditScore}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-ink-subtle">
        {GENERATION_CAVEAT} Individual performance reporting is deliberately not
        included.
      </p>
    </PlatformShell>
  );
}
