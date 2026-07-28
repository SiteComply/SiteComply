'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * PROTOTYPE (Worker Experience layout experiment) — a collapsible variant of the
 * shared <Section>. Same card shell and heading style, but the header is a button
 * that expands/collapses the body. Collapsed by default so the Worker Experience
 * tab reads as a compact index of settings the manager can open on demand.
 *
 * This is used ONLY by the ?layout=v2 prototype path; the original <Section>
 * (always-open) is unchanged, so removing the experiment is a one-line revert.
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl border border-line bg-surface shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-5 py-4 text-left hover:bg-surface-sunken"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
          {title}
        </h2>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}
