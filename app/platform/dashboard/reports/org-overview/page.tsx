import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  ReportHeader,
  ReportFilterBar,
  KpiCards,
} from '@/components/platform/ReportView';
import {
  SectionCard,
  TrendBars,
  RankedList,
  ModulePlaceholder,
} from '@/components/platform/ExecutiveDashboard';
import {
  requirePlatformViewer,
  assertModuleView,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canRunReport, canExportReport } from '@/services/reports/reportAccess';
import {
  parseReportFilters,
  reportFiltersQuery,
} from '@/services/reports/reportFilters';
import { getOrgOverview } from '@/services/reports/orgOverviewReport';
import { canUseAiSummaries } from '@/services/ai/aiConfig';
import { AiSummaryPanel } from '@/components/platform/AiSummaryPanel';
import { percentLabel } from '@/services/reports/reportFormat';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('org-overview')!;

/**
 * Organisation Overview — Director-only, organisation-wide executive dashboard.
 * KPI totals, attendance trend, contractor breakdown, site performance, plus
 * placeholders for the upcoming Documents / Audits / Actions modules. Aggregate
 * only; export gated + logged. Non-Directors are redirected (they can't run it).
 */
export default async function OrgOverviewReportPage({
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
  const filters = await parseReportFilters(
    {
      from: one(searchParams.from),
      to: one(searchParams.to),
      sites: many(searchParams.sites),
      includeCompleted: one(searchParams.includeCompleted),
    },
    viewer,
  );

  const canExport = canExportReport(viewer, REPORT);
  const scopeSites = viewer.sites.filter((s) => filters.siteIds.includes(s.id));
  const o = await getOrgOverview(scopeSites, filters.range);
  const showAiSummary = await canUseAiSummaries(viewer.role);

  return (
    <PlatformShell>
      <ReportHeader
        title="Organisation Overview"
        description={`Organisation-wide performance ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/org-overview/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      {showAiSummary && (
        <AiSummaryPanel
          targetType="ORG_OVERVIEW_REPORT"
          filters={{
            from: filters.fromStr,
            to: filters.toStr,
            sites: filters.requestedSiteIds ?? undefined,
          }}
        />
      )}

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/org-overview"
      />

      <KpiCards
        items={[
          { label: 'Total sites', value: o.totalSites },
          { label: 'Active workers', value: o.activeWorkers },
          {
            label: 'Check-ins',
            value: o.checkIns,
            sub: `avg ${o.avgPerDay}/day`,
          },
          { label: 'On site now', value: o.onSiteNow },
        ]}
      />
      <div className="mt-4">
        <KpiCards
          items={[
            { label: 'Compliance rate', value: percentLabel(o.compliancePct) },
            { label: 'Induction completion', value: percentLabel(o.inductionPct) },
            { label: 'Contractors', value: o.companies },
            { label: 'Sites in scope', value: o.totalSites },
          ]}
        />
      </div>

      <div className="mt-6">
        <SectionCard title="Attendance trend">
          <TrendBars data={o.trend} caption="check-ins per day" />
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Contractor breakdown">
          <RankedList
            rows={o.topCompanies.map((c) => ({
              label: c.company,
              value: c.checkIns,
              sub: `${c.workers} worker${c.workers === 1 ? '' : 's'}`,
            }))}
          />
        </SectionCard>
        <SectionCard title="Site performance">
          {o.sitePerformance.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No sites in scope.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 text-right font-medium">
                      Check-ins
                    </th>
                    <th className="px-5 py-2 text-right font-medium">
                      On site
                    </th>
                    <th className="px-5 py-2 text-right font-medium">
                      Compliance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.sitePerformance.map((s) => (
                    <tr key={s.siteId}>
                      <td className="px-5 py-2 text-ink">{s.siteName}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                        {s.checkIns}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                        {s.onSiteNow}
                      </td>
                      <td className="px-5 py-2 text-right font-semibold tabular-nums text-ink">
                        {percentLabel(s.compliancePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Upcoming modules
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <ModulePlaceholder
          title="Documents"
          icon="doc"
          note="Method statements, RAMS and certificate coverage across your sites."
        />
        <ModulePlaceholder
          title="Audits"
          icon="shield"
          note="Inspection pass rates and open findings by site."
        />
        <ModulePlaceholder
          title="Actions"
          icon="bolt"
          note="Open and overdue actions across the organisation."
        />
      </div>
    </PlatformShell>
  );
}
