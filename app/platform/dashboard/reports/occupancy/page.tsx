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
  getOccupancySummary,
  getOnSiteWorkers,
} from '@/services/reports/occupancyReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('occupancy')!;
const DISPLAY_LIMIT = 100;

/**
 * On-Site Occupancy report. Live on-site figures + check-in activity over the
 * date range, scoped to the viewer's sites. Clients see aggregate figures only.
 */
export default async function OccupancyReportPage({
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
  const summary = await getOccupancySummary(filters.siteIds, filters.range);
  const onSite = aggregate ? [] : await getOnSiteWorkers(filters.siteIds, DISPLAY_LIMIT);

  return (
    <PlatformShell>
      <ReportHeader
        title="On-Site Occupancy"
        description={`Live occupancy now, with check-in activity ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/occupancy/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/occupancy"
      />

      <KpiCards
        items={[
          { label: 'On site now', value: summary.onSiteNow },
          { label: 'Sites occupied', value: summary.sitesOccupied },
          { label: 'Check-ins (range)', value: summary.checkInsInRange },
          {
            label: 'Busiest day',
            value: summary.busiestDay ? summary.busiestDay.count : 0,
            sub: summary.busiestDay ? summary.busiestDay.date : `avg ${summary.avgPerDay}/day`,
          },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">By site</h2>
        </div>
        {summary.bySite.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No occupancy or check-ins for your sites in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="px-5 py-2 font-medium">Site</th>
                <th className="px-5 py-2 text-right font-medium">On site now</th>
                <th className="px-5 py-2 text-right font-medium">Check-ins (range)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.bySite.map((s) => (
                <tr key={s.name}>
                  <td className="px-5 py-2 text-ink">{s.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums font-semibold text-ink">{s.onSiteNow}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">{s.checkIns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {aggregate ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-subtle">
          Aggregate view — the currently-on-site worker list and export are not
          available for your role.
        </p>
      ) : (
        <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold text-ink">Currently on site</h2>
          </div>
          {onSite.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No workers currently on site.
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {onSite.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium text-ink">{r.workerName}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.workerCompany}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.siteName}</td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {formatDateTimeUK(r.checkedInAt)}
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
