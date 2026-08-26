import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PageHeader } from '@/components/platform/PageHeader';
import { Panel } from '@/components/platform/Panel';
import { SiteChipMultiSelect } from '@/components/platform/SiteChipMultiSelect';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { ReportFilters } from '@/services/reports/reportFilters';

/**
 * Shared building blocks for report pages: a header (with scope + optional
 * export), a GET-form filter bar (Date From / Date To + Site multi-select,
 * server-rendered), and a KPI card grid. The site chips add All/None as a
 * progressive enhancement; the checkboxes and the GET submission still work
 * with JavaScript unavailable.
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
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: 'Reports', href: '/platform/dashboard/reports' },
            { label: title },
          ]}
        />
      }
      title={title}
      description={description}
      meta={
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {scope}
        </span>
      }
      actions={
        exportHref && (
          <a
            href={exportHref}
            className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Export CSV
          </a>
        )
      }
    />
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
      className="mb-4 rounded-xl border border-line bg-surface-sunken px-4 py-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Date from</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className={field}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Date to</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className={field}
          />
        </label>
        <button
          type="submit"
          className="touch-target inline-flex items-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Apply filters
        </button>
      </div>

      {/* SC-025 — completed projects are excluded by default so a finished job
          stops dragging live compliance figures. The historical data is not
          gone; this puts it back. Shown only when there is something to
          include, so the control never appears as a puzzle. */}
      {filters.completedCount > 0 && (
        <label className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-sm text-ink">
          <input
            type="checkbox"
            name="includeCompleted"
            value="1"
            defaultChecked={filters.includeCompleted}
            className="h-4 w-4 accent-brand-600"
          />
          Include completed projects
          <span className="text-xs text-ink-subtle">
            ({filters.completedCount} completed{' '}
            {filters.completedCount === 1 ? 'project' : 'projects'} excluded by
            default)
          </span>
        </label>
      )}

      {/* Sites are chosen on almost every report run, so they are always
          visible. This was a <details> that collapsed above six sites, which
          cost a click on exactly the organisations with the most sites to
          choose between. The inputs are unchanged — same name="sites", same
          values, same GET submission — so nothing downstream is affected. */}
      {viewer.sites.length > 1 && (
        <SiteChipMultiSelect
          sites={viewer.sites.map((s) => ({ id: s.id, name: s.name }))}
          selectedIds={viewer.sites
            .filter((s) => selected.has(s.id))
            .map((s) => s.id)}
        />
      )}
    </form>
  );
}

export function KpiCards({
  items,
}: {
  items: { label: string; value: string | number; sub?: string }[];
}) {
  // Was four separate p-5 cards in their own grid — a row of widgets above the
  // report they describe. One strip now, matching the project summary on Site
  // Overview, so the figures read as one reading of one report.
  return (
    <Panel className="mb-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {items.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-line bg-surface-sunken px-3 py-2"
          >
            <p className="text-xs font-medium text-ink-subtle">{k.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-ink">
              {k.value}
            </p>
            {k.sub && <p className="mt-0.5 text-xs text-ink-subtle">{k.sub}</p>}
          </div>
        ))}
      </div>
    </Panel>
  );
}
