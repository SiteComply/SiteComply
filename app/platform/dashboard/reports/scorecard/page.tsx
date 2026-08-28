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
import {
  parseReportFilters,
  reportFiltersQuery,
} from '@/services/reports/reportFilters';
import { getScorecard } from '@/services/reports/scorecardReport';
import { canUseAiSummaries } from '@/services/ai/aiConfig';
import { AiSummaryPanel } from '@/components/platform/AiSummaryPanel';
import { percentLabel } from '@/services/reports/reportFormat';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('scorecard')!;

/**
 * Site Compliance Scorecard. One row per accessible site: attendance,
 * compliance %, induction completion %, active workers and contractor count.
 * Audit & action metrics are placeholders until those modules exist. Purely
 * aggregate; export is permission-gated.
 */
export default async function ScorecardReportPage({
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
  const scorecard = await getScorecard(scopeSites, filters.range);
  const showAiSummary = await canUseAiSummaries(viewer.role);

  return (
    <PlatformShell>
      <ReportHeader
        title="Site Compliance Scorecard"
        description={`Per-site scorecard ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/scorecard/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      {showAiSummary && (
        <AiSummaryPanel
          targetType="SCORECARD_REPORT"
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
        action="/platform/dashboard/reports/scorecard"
      />

      <KpiCards
        items={[
          { label: 'Sites', value: scorecard.totals.sites },
          { label: 'Check-ins', value: scorecard.totals.checkIns },
          { label: 'Active workers', value: scorecard.totals.activeWorkers },
          {
            label: 'Compliance',
            value: percentLabel(scorecard.totals.compliancePct),
            sub: `induction ${percentLabel(scorecard.totals.inductionPct)}`,
          },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">
            Scorecard by site
          </h2>
        </div>
        {scorecard.rows.length === 0 ? (
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
                    Active workers
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    Contractors
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    Compliance
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    Induction
                  </th>
                  <th className="px-5 py-2 text-right font-medium">Audits</th>
                  <th className="px-5 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {scorecard.rows.map((r) => (
                  <tr key={r.siteId}>
                    <td className="px-5 py-2 font-medium text-ink">
                      {r.siteName}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                      {r.checkIns}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                      {r.activeWorkers}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                      {r.companies}
                    </td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-ink">
                      {percentLabel(r.compliancePct)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">
                      {percentLabel(r.inductionPct)}
                    </td>
                    <td className="px-5 py-2 text-right text-ink-subtle">—</td>
                    <td className="px-5 py-2 text-right text-ink-subtle">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-ink-subtle">
        Audit &amp; action metrics will populate once the Audits and Actions
        modules are available.
      </p>
    </PlatformShell>
  );
}
