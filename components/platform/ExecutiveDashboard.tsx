import { ReactNode } from 'react';
import { PlatformIcon, type PlatformIconName } from './icons';

/**
 * Reusable executive-dashboard building blocks. Used by the Organisation
 * Overview report and designed to be reused by future module overviews
 * (Documents, Audits, Actions): a titled card, a lightweight CSS trend chart, a
 * ranked bar list, and a "coming soon" module placeholder tile.
 */

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Simple dependency-free bar chart. `data` dates are yyyy-mm-dd, ascending. */
export function TrendBars({
  data,
  caption,
}: {
  data: { date: string; count: number }[];
  caption?: string;
}) {
  if (data.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-subtle">
        No activity in this period.
      </p>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.count));
  const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className="px-5 py-4">
      <div className="flex h-40 items-end gap-1 overflow-x-auto">
        {data.map((d) => (
          <div
            key={d.date}
            className="flex h-full w-4 shrink-0 flex-col justify-end"
            title={`${ddmm(d.date)}: ${d.count}`}
          >
            <div
              className="w-full rounded-t bg-brand-500"
              style={{ height: `${Math.max(2, Math.round((d.count / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink-subtle">
        <span>{ddmm(data[0].date)}</span>
        {caption && <span>{caption}</span>}
        <span>{ddmm(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

/** Ranked list with proportional bars (e.g. contractor breakdown, top sites). */
export function RankedList({
  rows,
}: {
  rows: { label: string; value: number; sub?: string }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-subtle">No data.</p>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.label} className="px-5 py-2.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">
              {r.label}
              {r.sub && <span className="ml-2 text-xs text-ink-subtle">{r.sub}</span>}
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-ink">{r.value}</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.round((r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Placeholder tile for a module whose metrics aren't available yet. */
export function ModulePlaceholder({
  title,
  icon,
  note,
}: {
  title: string;
  icon: PlatformIconName;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <PlatformIcon name={icon} className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="ml-auto rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Coming soon
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">{note}</p>
    </div>
  );
}
