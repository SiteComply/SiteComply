import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  ReportHeader,
  ReportFilterBar,
  KpiCards,
} from '@/components/platform/ReportView';
import {
  requirePlatformViewer,
  assertModuleView,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canRunReport, canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters, reportFiltersQuery } from '@/services/reports/reportFilters';
import { getWorkforceSummary } from '@/services/reports/workforceReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('workforce')!;

/**
 * Workforce & Company report. Attendance grouped by company/subcontractor over
 * the date range, scoped to the viewer's sites. Purely aggregate (no worker
 * identities), so all roles see the same breakdown; export is permission-gated.
 */
export default async function WorkforceReportPage({
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

  const canExport = canExportReport(viewer, REPORT);
  const summary = await getWorkforceSummary(filters.siteIds, filters.range);

  return (
    <PlatformShell>
      <ReportHeader
        title="Workforce & Company"
        description={`Attendance by company from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/workforce/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/workforce"
      />

      <KpiCards
        items={[
          { label: 'Companies', value: summary.companies },
          { label: 'Unique workers', value: summary.uniqueWorkers },
          { label: 'Check-ins (range)', value: summary.checkInsInRange },
          { label: 'Sites', value: summary.sites },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">By company</h2>
        </div>
        {summary.byCompany.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No check-ins for your sites in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="px-5 py-2 font-medium">Company / subcontractor</th>
                <th className="px-5 py-2 text-right font-medium">Unique workers</th>
                <th className="px-5 py-2 text-right font-medium">Check-ins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.byCompany.map((c) => (
                <tr key={c.company}>
                  <td className="px-5 py-2 font-medium text-ink">{c.company}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">{c.workers}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">{c.checkIns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PlatformShell>
  );
}
