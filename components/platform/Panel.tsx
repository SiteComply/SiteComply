import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The workspace panel — one definition of "a bounded region of a screen".
 *
 * This is EXTRACTED, not invented. The composition the brief points at as the
 * target already existed inside SC-014's Audit Scoring screen as a private
 * helper: `p-4`, a `text-sm font-bold text-ink` heading, an optional hint line.
 * Everywhere else grew its own version — the site tabs used `p-5` with an
 * uppercase muted heading, other screens inlined the classes by hand. Same idea,
 * five spellings, which is a large part of why the portal reads as assembled
 * rather than designed.
 *
 * Presentation only. A panel decides how a region looks, never what may appear
 * inside it — callers keep every permission gate exactly where it was.
 *
 * `tone`:
 *   surface  — the default. A panel sitting on the page.
 *   sunken   — a panel nested INSIDE another panel, where a second white card on
 *              white would just add a border for nothing.
 *   flat     — grouping without any frame at all: the heading and spacing do the
 *              work. Use when a screen already has enough boxes.
 */
export function Panel({
  title,
  hint,
  actions,
  tone = 'surface',
  padding = 'comfortable',
  className,
  bodyClassName,
  children,
}: {
  /** Optional — a panel used purely to bound a region needs no heading. */
  title?: ReactNode;
  /** One short line under the heading. Prefer none: the brief asks for less prose. */
  hint?: ReactNode;
  /** Controls belonging to this panel, right-aligned on the heading row. */
  actions?: ReactNode;
  tone?: 'surface' | 'sunken' | 'flat';
  padding?: 'comfortable' | 'compact' | 'none';
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || actions);

  return (
    <section
      className={cn(
        'rounded-xl',
        tone === 'surface' && 'border border-line bg-surface shadow-card',
        tone === 'sunken' && 'border border-line bg-surface-sunken',
        padding === 'comfortable' && 'p-4',
        padding === 'compact' && 'p-3',
        className,
      )}
    >
      {hasHeader && (
        <div
          className={cn(
            'flex flex-wrap items-start justify-between gap-x-4 gap-y-1',
            hint ? 'mb-0.5' : 'mb-3',
          )}
        >
          {title && <h2 className="text-sm font-bold text-ink">{title}</h2>}
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      {hint && <p className="mb-3 text-xs text-ink-subtle">{hint}</p>}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * A row of panels that belong to one another — the composition the brief calls
 * "a workspace" rather than "widgets placed next to each other".
 *
 * `cols` is the DESKTOP column count; every layout is one column on a phone.
 * `rail` is the main-plus-sidebar shape SC-024's Close-Out Pack generator uses
 * and the brief singles out as working well.
 */
export function PanelRow({
  cols = 2,
  className,
  children,
}: {
  cols?: 2 | 3 | 4 | 'rail';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-4',
        cols === 2 && 'lg:grid-cols-2',
        cols === 3 && 'lg:grid-cols-3',
        cols === 4 && 'sm:grid-cols-2 xl:grid-cols-4',
        cols === 'rail' && 'lg:grid-cols-[1fr_380px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
