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
  getComplianceSummary,
  getComplianceRows,
  pct,
} from '@/services/reports/complianceReport';

export const dynamic = 'force-dynamic';

const REPORT = getReportType('compliance')!;
const DISPLAY_LIMIT = 100;

/**
 * Compliance report. Scoped to the viewer's assigned sites. Clients see
 * aggregate rates only — no worker-level rows. Export is gated by the
 * reports-export permission.
 */
export default async function ComplianceReportPage({
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
  const summary = await getComplianceSummary(filters.siteIds, filters.range);
  const rows = aggregate
    ? []
    : await getComplianceRows(filters.siteIds, filters.range, DISPLAY_LIMIT);

  return (
    <PlatformShell>
      <ReportHeader
        title="Compliance"
        description={`Induction & acknowledgement rates from ${filters.fromStr} to ${filters.toStr}.`}
        scope={describeScope(viewer)}
        exportHref={
          canExport
            ? `/api/platform/reports/compliance/export?${reportFiltersQuery(filters)}`
            : undefined
        }
      />

      <ReportFilterBar
        viewer={viewer}
        filters={filters}
        action="/platform/dashboard/reports/compliance"
      />

      <KpiCards
        items={[
          { label: 'Compliant', value: `${pct(summary.compliant, summary.total)}%`, sub: `${summary.compliant} of ${summary.total}` },
          { label: 'Incomplete', value: summary.incomplete },
          { label: 'PPE confirmed', value: `${pct(summary.ppe, summary.total)}%` },
          { label: 'GDPR consent', value: `${pct(summary.gdpr, summary.total)}%` },
        ]}
      />

      <div className="mt-4">
        <KpiCards
          items={[
            { label: 'Site rules acknowledged', value: `${pct(summary.rules, summary.total)}%` },
            { label: 'Safe working agreed', value: `${pct(summary.safe, summary.total)}%` },
            { label: 'Total check-ins', value: summary.total },
            { label: 'Sites covered', value: summary.bySite.length },
          ]}
        />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">Compliance by site</h2>
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
                <th className="px-5 py-2 text-right font-medium">Compliant</th>
                <th className="px-5 py-2 text-right font-medium">Total</th>
                <th className="px-5 py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.bySite.map((s) => (
                <tr key={s.name}>
                  <td className="px-5 py-2 text-ink">{s.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink">{s.compliant}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-ink-subtle">{s.total}</td>
                  <td className="px-5 py-2 text-right tabular-nums font-semibold text-ink">{s.pct}%</td>
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
            <h2 className="text-base font-semibold text-ink">Records</h2>
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
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 font-medium">Checked in</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 text-center font-medium">PPE</th>
                    <th className="px-5 py-2 text-center font-medium">Rules</th>
                    <th className="px-5 py-2 text-center font-medium">Safe</th>
                    <th className="px-5 py-2 text-center font-medium">GDPR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium text-ink">
                        {r.workerName}
                        <span className="block text-xs text-ink-subtle">
                          {r.workerCompany}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-ink-subtle">{r.siteName}</td>
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-subtle">
                        {formatDateTimeUK(r.checkedInAt)}
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
                      <Tick ok={r.ppe} />
                      <Tick ok={r.rules} />
                      <Tick ok={r.safe} />
                      <Tick ok={r.gdpr} />
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

function Tick({ ok }: { ok: boolean }) {
  return (
    <td className="px-5 py-2 text-center">
      <span className={ok ? 'font-semibold text-safe-700' : 'text-ink-subtle'}>
        {ok ? '✓' : '—'}
      </span>
    </td>
  );
}
