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
  getKnowledgeCheckSummary,
  getKnowledgeCheckRows,
} from '@/services/reports/knowledgeCheckReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('knowledge-checks')!;
const DISPLAY_LIMIT = 100;

/**
 * Knowledge Checks report (SC-005). Scoped to the viewer's assigned sites
 * (Directors see all). Clients get aggregate figures only. Export gated by the
 * reports-export permission and audit-logged.
 */
export default async function KnowledgeChecksReportPage({
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

  const aggregate = isAggregateOnly(viewer, REPORT);
  const canExport = canExportReport(viewer, REPORT);
  const summary = await getKnowledgeCheckSummary(
    filters.siteIds,
    filters.range,
  );
  const rows = aggregate
    ? []
    : await getKnowledgeCheckRows(
        filters.siteIds,
        filters.range,
        DISPLAY_LIMIT,
      );

  return (
    <PlatformShell>
      <ReportHeader
        title="Knowledge Checks"
        description={`Passed checks from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/knowledge-checks/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/knowledge-checks"
      />

      <KpiCards
        items={[
          { label: 'Checks passed', value: summary.passed },
          {
            // Replaces "First-time pass". A pass rate would not work here:
            // KnowledgeCheckAttemptStatus is IN_PROGRESS or PASSED — there is no
            // FAILED state, because a worker retries until they pass — so any
            // pass rate reads 100% by construction and tells a manager nothing.
            // "Who completed it" is the question this report exists to answer.
            label: 'Workers assessed',
            value: summary.workersAssessed,
            sub: 'distinct workers',
          },
          {
            label: 'Skipped',
            value: summary.skipped,
            sub: 'no questions available',
          },
          {
            label: 'Flagged questions',
            value: summary.flaggedOpen,
            sub: 'awaiting review',
          },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">Passed by site</h2>
        </div>
        {summary.bySite.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No knowledge checks passed in this period for your sites.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2 font-medium">Site</th>
                  <th className="px-5 py-2 text-right font-medium">Passed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.bySite.map((s) => (
                  <tr key={s.name}>
                    <td className="px-5 py-2 text-ink">{s.name}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">
                      {s.passed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <h2 className="text-base font-semibold text-ink">Worker results</h2>
            {summary.passed > rows.length && (
              <span className="text-xs text-ink-subtle">
                Showing {rows.length} of {summary.passed} — export CSV for all
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No knowledge checks passed in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2 font-medium">Worker</th>
                    <th className="px-5 py-2 font-medium">Company</th>
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 font-medium">Completed</th>
                    {/* Question-attempt analytics have been removed from this
                        report: it answers who completed the knowledge check,
                        when, how many questions it covered — not how many they
                        got wrong on the first attempt. incorrectFirstTryCount is
                        still recorded and still exported for anyone who needs it
                        per worker; it is simply not surfaced here. */}
                    <th className="px-5 py-2 text-right font-medium">
                      Questions
                    </th>
                    <th className="px-5 py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium text-ink">
                        {r.workerName}
                      </td>
                      <td className="px-5 py-2 text-ink-subtle">
                        {r.workerCompany}
                      </td>
                      <td className="px-5 py-2 text-ink-subtle">
                        {r.siteName}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {r.completedAt ? formatDateTimeUK(r.completedAt) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-ink">
                        {r.questionCount}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">
                        {r.durationSeconds != null
                          ? `${r.durationSeconds}s`
                          : '—'}
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
