'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type {
  PanelVisibility,
  WorkerDashboardPanelValue,
} from '@/services/workerDashboard/dashboardPanels';
import { WorkerIcon, type WorkerIconName } from './icons';

/**
 * Worker Dashboard navigation (SC-003). Vertical sidebar on desktop, collapsing
 * to a horizontal scroller on phones — the primary worker device.
 *
 * Every destination except the dashboard itself is tied to a configurable panel,
 * so a site that has switched a panel off never shows a link to it. `Check out`
 * is a panel too, but it is locked on, so it is always present.
 *
 * S3: on phones the items stack their icon over a short label, which roughly
 * halves each pill, and the strip carries edge fades plus scroll buttons so it
 * is visible that the list continues past the right edge. `shortLabel` is always
 * a substring of `label`, which the accessible name keeps, so the visible text
 * never disagrees with what a screen reader announces (WCAG 2.5.3).
 */
const WORKER_NAV: {
  href: string;
  label: string;
  /** Phone-width label. Must be contained in `label`. */
  shortLabel: string;
  icon: WorkerIconName;
  /** Panels that keep this item visible — shown if ANY of them is enabled. */
  panels: WorkerDashboardPanelValue[];
}[] = [
  {
    href: '/worker/dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    icon: 'grid',
    panels: [],
  },
  {
    // Always visible (panels: []) — a worker's own attendance record is never
    // hidden by a site's panel config (SC-010).
    href: '/worker/attendance',
    label: 'Attendance',
    shortLabel: 'Attendance',
    icon: 'clock',
    panels: [],
  },
  // Emergency info and Contacts lead the list rather than closing it: they are
  // the two destinations whose value depends on being reachable immediately,
  // and on a phone anything past the fifth item needs a deliberate swipe.
  {
    href: '/worker/emergency',
    label: 'Emergency info',
    shortLabel: 'Emergency',
    icon: 'alert',
    panels: ['EMERGENCY_INFORMATION', 'FIRST_AIDER', 'FIRE_ASSEMBLY_POINT'],
  },
  {
    href: '/worker/contacts',
    label: 'Contacts',
    shortLabel: 'Contacts',
    icon: 'phone',
    panels: ['SITE_CONTACTS'],
  },
  // Then the things a worker opens on an ordinary shift.
  {
    href: '/worker/bulletins',
    label: 'Bulletins',
    shortLabel: 'Bulletins',
    icon: 'megaphone',
    panels: ['DAILY_BULLETIN'],
  },
  {
    href: '/worker/rams',
    label: 'RAMS',
    shortLabel: 'RAMS',
    icon: 'rams',
    panels: ['RAMS'],
  },
  {
    href: '/worker/documents',
    label: 'Documents',
    shortLabel: 'Documents',
    icon: 'doc',
    panels: ['SITE_DOCUMENTS'],
  },
  {
    href: '/worker/permits',
    label: 'Permits',
    shortLabel: 'Permits',
    icon: 'permit',
    panels: ['ACTIVE_PERMITS'],
  },
  {
    href: '/worker/actions',
    label: 'Actions',
    shortLabel: 'Actions',
    icon: 'clipboard',
    panels: ['OUTSTANDING_ACTIONS'],
  },
  // Reference material a worker looks up rather than does, so it closes the list.
  {
    // Always visible (SC-011) — the worker's own signed induction records.
    href: '/worker/inductions',
    label: 'Inductions',
    shortLabel: 'Inductions',
    icon: 'clipboard',
    panels: [],
  },
  {
    href: '/worker/site-information',
    label: 'Site information',
    shortLabel: 'Site info',
    icon: 'building',
    panels: ['SITE_INFORMATION'],
  },
];

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-ink-subtle"
    >
      <path d={direction === 'right' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
    </svg>
  );
}

export function WorkerNav({
  panels,
  unreadBulletins = 0,
}: {
  panels: PanelVisibility;
  unreadBulletins?: number;
}) {
  const pathname = usePathname();
  const items = WORKER_NAV.filter(
    (item) => item.panels.length === 0 || item.panels.some((p) => panels[p]),
  );

  const scrollerRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  // Which edges have more items past them. Drives the fades and the buttons;
  // both stay hidden when the strip fits, and on desktop where it never scrolls.
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({
      start: el.scrollLeft > 1,
      end: max > 1 && el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Bring the current section into view on load. Set scrollLeft directly rather
  // than scrollIntoView, which would also scroll the page.
  useEffect(() => {
    const el = scrollerRef.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    const target =
      current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    el.scrollLeft = Math.max(0, target);
    measure();
  }, [pathname, measure]);

  return (
    <div className="relative">
      <nav
        ref={scrollerRef}
        onScroll={measure}
        aria-label="Worker dashboard sections"
        className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
      >
        {items.map((item) => {
          const active =
            item.href === '/worker/dashboard'
              ? pathname === '/worker/dashboard'
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'touch-target relative flex shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-center text-[11px] font-semibold leading-tight transition-colors',
                'md:min-h-0 md:min-w-0 md:shrink md:flex-row md:justify-start md:gap-3 md:px-3 md:py-2.5 md:text-left md:text-sm md:font-medium',
                active
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-600/20'
                  : 'text-ink-muted hover:bg-brand-50 hover:text-brand-700',
              )}
            >
              <WorkerIcon name={item.icon} className="h-6 w-6 shrink-0 md:h-5 md:w-5" />
              <span className="md:hidden">{item.shortLabel}</span>
              <span className="hidden md:inline md:flex-1">{item.label}</span>
              {item.href === '/worker/bulletins' && unreadBulletins > 0 && (
                <span
                  aria-label={`${unreadBulletins} unread bulletins`}
                  className={cn(
                    'absolute right-0.5 top-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold md:static md:right-auto md:top-auto',
                    active
                      ? 'bg-white text-brand-700'
                      : 'bg-danger-500 text-white',
                  )}
                >
                  {unreadBulletins > 99 ? '99+' : unreadBulletins}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/*
        Overflow affordances, phones only: a fade with a chevron in it at each
        end that has items past it. Deliberately NOT a button — it floats over
        the strip, and a control there would take taps away from the item it
        covers. Swiping is the gesture; this only has to say there is more.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-start rounded-l-lg bg-gradient-to-r from-surface via-surface/85 to-transparent pl-0.5 transition-opacity md:hidden',
          overflow.start ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Chevron direction="left" />
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-end rounded-r-lg bg-gradient-to-l from-surface via-surface/85 to-transparent pr-0.5 transition-opacity md:hidden',
          overflow.end ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Chevron direction="right" />
      </div>
    </div>
  );
}
