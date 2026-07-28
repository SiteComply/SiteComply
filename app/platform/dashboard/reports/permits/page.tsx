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
import {
  parseReportFilters,
  reportFiltersQuery,
} from '@/services/reports/reportFilters';
import {
  getPermitReportSummary,
  getPermitReportRows,
} from '@/services/reports/permitsReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('permits')!;
const DISPLAY_LIMIT = 100;

/** Permits to Work report (SC-009). Scoped to the viewer's sites. */
export default async function PermitsReportPage({
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
  const summary = await getPermitReportSummary(filters.siteIds, filters.range);
  const rows = aggregate
    ? []
    : (await getPermitReportRows(filters.siteIds, filters.range)).slice(
        0,
        DISPLAY_LIMIT,
      );

  return (
    <PlatformShell>
      <ReportHeader
        title="Permits to Work"
        description={`Permits submitted from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/permits/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/permits"
      />

      <KpiCards
        items={[
          { label: 'Permits', value: summary.total },
          { label: 'Awaiting approval', value: summary.awaiting },
          { label: 'Approved', value: summary.approved },
          { label: 'Rejected', value: summary.rejected },
        ]}
      />

      {aggregate ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-subtle">
          Aggregate view — permit-level detail and export are not available for
          your role.
        </p>
      ) : (
        <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold text-ink">Permit records</h2>
            {summary.total > rows.length && (
              <span className="text-xs text-ink-subtle">
                Showing {rows.length} of {summary.total} — export CSV for all
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No permits in this period for your sites.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2 font-medium">Reference</th>
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-5 py-2 font-medium">Worker</th>
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Submitted</th>
                    <th className="px-5 py-2 font-medium">Approved by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.reference}>
                      <td className="px-5 py-2 font-mono text-ink">
                        {r.reference}
                      </td>
                      <td className="px-5 py-2 text-ink">{r.permitType}</td>
                      <td className="px-5 py-2 text-ink-subtle">
                        {r.workerName}
                      </td>
                      <td className="px-5 py-2 text-ink-subtle">
                        {r.siteName}
                      </td>
                      <td className="px-5 py-2 text-ink">{r.status}</td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {formatDateTimeUK(r.submittedAt)}
                      </td>
                      <td className="px-5 py-2 text-ink-subtle">
                        {r.approvedByName ?? '—'}
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
