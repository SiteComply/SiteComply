import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TableSurface } from '@/components/platform/TableSurface';

/**
 * A work surface: one list of things to work through, beside a rail showing the
 * one you have selected.
 *
 * WHY THIS EXISTS. Phases 1–4 fixed how panels were FRAMED but not what a panel
 * WAS, so screens like Site → Compliance and Site → Workers still read as
 * widgets: they were organised by data source (one panel per query) rather than
 * by the question being asked. Two lists side by side are still two lists,
 * however large the card or thin the border.
 *
 * The benchmark screens the brief points at (SC-014 Audit Scoring, SC-024
 * Close-Out Pack) share three structural properties, none of them stylistic:
 * one primary object, adjacency that MEANS something (the right-hand side is the
 * consequence of the left), and one task decomposed rather than several topics
 * collected.
 *
 * A collection screen has no single computed object and no live cause/effect, so
 * copying the three-column LOOK would produce a wider card that still isn't a
 * workspace. The honest equivalent is master–detail: the rail is *about* the row
 * you selected, so adjacency earns its meaning the same way SC-024's preview
 * rail does — and it uses the same proportions.
 *
 * Selection lives in the URL (`?item=`), matching `?section=` from Phase 3, so a
 * selected row is linkable, survives a refresh and needs no client state.
 *
 * Presentation only. This component never evaluates a permission or decides what
 * a row may contain; callers pass already-authorised content.
 */
export function WorkSurface({
  toolbar,
  footer,
  rail,
  railTitle,
  railEmpty = 'Select a row to see its details.',
  children,
}: {
  /** The caller's filter form or tab strip, styled with TABLE_TOOLBAR_CLASS. */
  toolbar?: ReactNode;
  /** Pagination or totals, inside the table surface. */
  footer?: ReactNode;
  /** Detail for the selected row. Null when nothing is selected. */
  rail?: ReactNode;
  railTitle?: ReactNode;
  /** Shown in place of the rail when no row is selected. */
  railEmpty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
      <TableSurface toolbar={toolbar} footer={footer} className="min-w-0">
        {children}
      </TableSurface>

      {/* The rail is sticky so it stays with you while the list scrolls — the
          point of master–detail is not having to lose your place. */}
      <aside className="lg:sticky lg:top-6">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          {railTitle && (
            <h2 className="mb-3 text-sm font-bold text-ink">{railTitle}</h2>
          )}
          {rail ?? (
            <p className="py-6 text-center text-sm text-ink-subtle">
              {railEmpty}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Row highlight for the selected item. Selection must be visible in the list. */
export function selectedRowClass(isSelected: boolean): string {
  return cn(
    'cursor-pointer transition-colors',
    isSelected ? 'bg-brand-50' : 'hover:bg-brand-50/30',
  );
}

/** One label/value line in a rail. */
export function RailDetail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Resolve the selected item from `?item=`, falling back to nothing selected.
 *
 * Deliberately does NOT fall back to the first row: a rail that pre-selects
 * something the user never chose invites them to act on the wrong record.
 * Returns null for an id that is not in the list, so a stale or guessed id
 * simply shows the empty rail rather than confirming the id exists.
 */
export function resolveSelected<T extends { id: string }>(
  raw: string | string[] | undefined,
  rows: T[],
): T | null {
  const want = Array.isArray(raw) ? raw[0] : raw;
  if (!want) return null;
  return rows.find((r) => r.id === want) ?? null;
}
