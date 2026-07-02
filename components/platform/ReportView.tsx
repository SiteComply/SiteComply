import Link from 'next/link';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { ReportFilters } from '@/services/reports/reportFilters';

/**
 * Shared building blocks for report pages: a header (with scope + optional
 * export), a GET-form filter bar (Date From / Date To + Site multi-select,
 * server-rendered, no client JS), and a KPI card grid.
 */

export function ReportHeader({
  title,
  description,
  scope,
  exportHref,
}: {
  title: string;
  description: string;
  scope: string;
  exportHref?: string;
}) {
  return (
    <header className="mb-6">
      <Link
        href="/platform/dashboard/reports"
        className="text-sm font-semibold text-brand-700"
      >
        ← All reports
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="text-ink-muted">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {scope}
          </span>
          {exportHref && (
            <a
              href={exportHref}
              className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Export CSV
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function ReportFilterBar({
  viewer,
  filters,
  action,
}: {
  viewer: PlatformViewer;
  filters: ReportFilters;
  action: string;
}) {
  const selected = new Set(filters.requestedSiteIds ?? viewer.siteIds);
  const field =
    'touch-target rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink';
  return (
    <form
      method="get"
      action={action}
      className="mb-6 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Date from</span>
          <input type="date" name="from" defaultValue={filters.fromStr} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Date to</span>
          <input type="date" name="to" defaultValue={filters.toStr} className={field} />
        </label>
        <button
          type="submit"
          className="touch-target inline-flex items-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Apply filters
        </button>
      </div>

      {viewer.sites.length > 1 && (
        <fieldset className="mt-4 border-t border-line pt-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Sites
          </legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {viewer.sites.map((s) => (
              <label
                key={s.id}
                className="inline-flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  name="sites"
                  value={s.id}
                  defaultChecked={selected.has(s.id)}
                  className="h-4 w-4 accent-brand-600"
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </form>
  );
}

export function KpiCards({
  items,
}: {
  items: { label: string; value: string | number; sub?: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="rounded-xl border border-line bg-surface p-5 shadow-card"
        >
          <p className="text-sm font-medium text-ink-subtle">{k.label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-ink">
            {k.value}
          </p>
          {k.sub && <p className="mt-0.5 text-xs text-ink-subtle">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}
