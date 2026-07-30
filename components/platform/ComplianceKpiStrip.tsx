import Link from 'next/link';
import type { ComplianceKpis } from '@/services/reports/complianceActivityReport';

/**
 * SC-020 Phase 3 — summary KPIs on the Compliance Calendar.
 *
 * The calendar stays the primary experience, so the headline numbers live here
 * while the detailed reporting sits in the Reports module. Deliberately compact:
 * six figures and a link, not a dashboard competing with the grid below it.
 *
 * A null completion rate renders as "—", never 0% — a site with nothing yet due
 * is not a site failing its compliance.
 */
export function ComplianceKpiStrip({
  kpis,
  reportHref,
}: {
  kpis: ComplianceKpis;
  reportHref: string;
}) {
  const cells: { label: string; value: string; tone?: string }[] = [
    {
      label: 'Completion',
      value: kpis.completionRate === null ? '—' : `${kpis.completionRate}%`,
    },
    { label: 'Outstanding', value: String(kpis.outstanding) },
    {
      label: 'Overdue',
      value: String(kpis.overdue),
      tone: kpis.overdue > 0 ? 'text-danger-600' : undefined,
    },
    {
      label: 'Escalated',
      value: String(kpis.escalated),
      tone: kpis.escalated > 0 ? 'text-danger-700' : undefined,
    },
    { label: 'Upcoming', value: String(kpis.upcoming) },
    { label: 'Schedules', value: String(kpis.activeSchedules) },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Compliance at a glance</h3>
        <Link
          href={reportHref}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Full report →
        </Link>
      </div>
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label}>
            <dd className={`text-2xl font-bold ${c.tone ?? 'text-ink'}`}>
              {c.value}
            </dd>
            <dt className="text-xs text-ink-subtle">{c.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
