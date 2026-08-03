import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A register — filters and their table as ONE surface.
 *
 * Every register rendered these as two separate floating cards: a bordered,
 * shadowed filter form with `mb-4` beneath it, then a bordered, shadowed section
 * holding the table. Two boxes, one tool. The gap between them said "these are
 * unrelated things" when the whole purpose of the top box is to change the
 * contents of the bottom one.
 *
 * Joining them costs nothing behaviourally: the toolbar is still the caller's
 * own `<form method="get">` with the same fields, names and submit button, so
 * filtering, query parameters and CSV exports are untouched. Only the framing
 * moves.
 */
export function TableSurface({
  toolbar,
  footer,
  className,
  children,
}: {
  /** The caller's filter form. Give it `TABLE_TOOLBAR_CLASS`. */
  toolbar?: ReactNode;
  /** Pagination or totals — sits below the body, inside the same surface. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface shadow-card',
        className,
      )}
    >
      {toolbar}
      {children}
      {footer}
    </section>
  );
}

/**
 * Classes for the caller's filter `<form>` so it reads as the top edge of the
 * surface rather than a card of its own: no border of its own except the rule
 * separating it from the rows, and a recessed background so the eye treats it
 * as a control strip rather than data.
 */
export const TABLE_TOOLBAR_CLASS =
  'flex flex-wrap items-end gap-3 border-b border-line bg-surface-sunken px-4 py-3';

/**
 * The empty state for a register. Same wording the callers already used — this
 * only stops each register inventing its own padding for the same message.
 */
export function TableEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-ink-subtle">{children}</p>
  );
}
