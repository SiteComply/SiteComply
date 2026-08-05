'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * SC-020 — the calendar's date selector: one control reading "August 2026" that
 * opens a small picker.
 *
 * It replaces a pair of Month and Year dropdowns. Two selects worked, but they
 * made choosing a date a two-part operation on two separate controls, and they
 * said nothing about where you were until you read both. One button states the
 * period you are looking at and is also the way to change it.
 *
 * DEPENDENCY-FREE, like every other interactive piece in this product (the
 * signature pad, the photo annotator, the donut chart). A date picker is a
 * twelve-item grid and a year stepper; it does not justify a library, and the
 * ones that would fit bring their own styling to argue with.
 *
 * Selecting a month is a real navigation, not client state — the server owns the
 * displayed window and occurrence generation runs for it, which is why the
 * prev/next arrows are links too.
 */
export function MonthPicker({
  /** The displayed month, `YYYY-MM`. */
  value,
  /** Today's month, `YYYY-MM` — marked so "now" is findable in any year. */
  currentMonth,
  onSelect,
}: {
  value: string;
  currentMonth: string;
  onSelect: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // The year being BROWSED in the popover, which is not necessarily the year
  // being displayed: you can step to 2028, decide against it and close, and the
  // calendar behind is untouched. Reset on each open so it never reopens
  // somewhere you did not leave it.
  const [browseYear, setBrowseYear] = useState(() => Number(value.slice(0, 4)));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const year = value.slice(0, 4);
  const monthIndex = Number(value.slice(5, 7)) - 1;
  const label = `${MONTHS_LONG[monthIndex]} ${year}`;

  useEffect(() => {
    if (!open) return;
    setBrowseYear(Number(value.slice(0, 4)));
    // Move focus into the panel so the picker is usable from the keyboard the
    // moment it opens, and so Escape has somewhere sensible to return from.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Return focus to the trigger, or the tab order restarts at the top.
        (
          wrapRef.current?.querySelector('button') as HTMLElement | null
        )?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, value]);

  function choose(monthNumber: number) {
    setOpen(false);
    onSelect(`${browseYear}-${String(monthNumber).padStart(2, '0')}`);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken"
      >
        {label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'h-4 w-4 text-ink-subtle transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose month"
          tabIndex={-1}
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-card focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setBrowseYear((y) => y - 1)}
              aria-label="Previous year"
              className="rounded-lg border border-line px-2 py-1 text-sm text-ink hover:bg-surface-sunken"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-ink" aria-live="polite">
              {browseYear}
            </span>
            <button
              type="button"
              onClick={() => setBrowseYear((y) => y + 1)}
              aria-label="Next year"
              className="rounded-lg border border-line px-2 py-1 text-sm text-ink hover:bg-surface-sunken"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {MONTHS_SHORT.map((m, i) => {
              const cell = `${browseYear}-${String(i + 1).padStart(2, '0')}`;
              const selected = cell === value;
              const isCurrent = cell === currentMonth;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => choose(i + 1)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                    selected
                      ? 'bg-brand-500 text-white'
                      : isCurrent
                        ? // This month, when you are browsing another year or
                          // month — outlined rather than filled so it is
                          // findable without competing with the selection.
                          'border border-brand-500 text-brand-700 hover:bg-brand-50'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Jumping to a specific DATE lands on the month containing it — the
              calendar is a month view, so that is the whole of what a date can
              mean here. `type="date"` rather than `type="month"`: Firefox has a
              native date picker and no month one. */}
          <label className="mt-3 block border-t border-line pt-3 text-xs font-medium text-ink-muted">
            Go to date
            <input
              type="date"
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                setOpen(false);
                onSelect(v.slice(0, 7));
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
      )}
    </div>
  );
}
