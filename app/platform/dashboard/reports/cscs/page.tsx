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
import { parseReportFilters, reportFiltersQuery } from '@/services/reports/reportFilters';
import { getCscsSummary, getCscsRows } from '@/services/reports/cscsReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('cscs')!;
const DISPLAY_LIMIT = 100;

/**
 * CSCS / Competency report. Distinct workers on the viewer's sites with their
 * CSCS card details; expired cards flagged. Clients see aggregate only. Export
 * is restricted to Director / Project Manager / Site Manager / H&S Consultant.
 */
export default async function CscsReportPage({
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
  const summary = await getCscsSummary(filters.siteIds, filters.range);
  const rows = aggregate ? [] : await getCscsRows(filters.siteIds, filters.range, DISPLAY_LIMIT);

  return (
    <PlatformShell>
      <ReportHeader
        title="CSCS / Competency"
        description={`Workers on your sites ${filters.fromStr} to ${filters.toStr}, by CSCS card.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/cscs/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar viewer={viewer} filters={filters} action="/platform/dashboard/reports/cscs" />

      <KpiCards
        items={[
          { label: 'Workers', value: summary.totalWorkers },
          { label: 'Valid cards', value: summary.valid },
          { label: 'Expired cards', value: summary.expired },
          { label: 'No card recorded', value: summary.none },
        ]}
      />

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">By card type</h2>
        </div>
        {summary.byType.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No workers on your sites in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="px-5 py-2 font-medium">CSCS card</th>
                <th className="px-5 py-2 text-right font-medium">Workers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.byType.map((t) => (
                <tr key={t.label}>
                  <td className="px-5 py-2 text-ink">{t.label}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {aggregate ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-subtle">
          Aggregate view — individual worker card details and export are not
          available for your role.
        </p>
      ) : (
        <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold text-ink">Workers</h2>
            {summary.totalWorkers > rows.length && (
              <span className="text-xs text-ink-subtle">
                Showing {rows.length} of {summary.totalWorkers} — export for all
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-subtle">
              No workers on your sites in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-subtle">
                    <th className="px-5 py-2 font-medium">Worker</th>
                    <th className="px-5 py-2 font-medium">Company</th>
                    <th className="px-5 py-2 font-medium">CSCS card</th>
                    <th className="px-5 py-2 font-medium">Expiry</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium text-ink">{r.workerName}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.workerCompany}</td>
                      <td className="px-5 py-2 text-ink-subtle">{r.cardTypeLabel}</td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {r.expiry ? formatDateUK(r.expiry) : '—'}
                      </td>
                      <td className="px-5 py-2">
                        <span
                          className={
                            r.status === 'valid'
                              ? 'font-semibold text-safe-700'
                              : r.status === 'expired'
                                ? 'font-semibold text-danger-600'
                                : 'text-ink-subtle'
                          }
                        >
                          {r.status === 'valid'
                            ? 'Valid'
                            : r.status === 'expired'
                              ? 'Expired'
                              : 'No card'}
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
