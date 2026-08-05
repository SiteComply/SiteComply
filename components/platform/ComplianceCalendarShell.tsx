'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ComplianceCalendar,
  type CalendarItem,
} from '@/components/platform/ComplianceCalendar';
import { ScheduleActivityForm } from '@/components/platform/ScheduleActivityForm';

const MONTHS = [
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
 * SC-020 Phase 1 — the client shell holding the calendar header controls from the
 * REV-1 example (Filter / All Sites / Today / prev-next / + Schedule Activity)
 * and the schedule dialog. Period navigation is done with links so the server
 * component re-renders and generation runs for the new window.
 */
export function ComplianceCalendarShell({
  monthStart,
  monthLabel,
  prevHref,
  nextHref,
  todayHref,
  gridDays,
  items,
  todayLocal,
  sites,
  templates,
  roles,
  people,
  selectedSiteId,
  canManage,
}: {
  monthStart: string;
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  gridDays: string[];
  items: CalendarItem[];
  todayLocal: string;
  sites: { id: string; name: string }[];
  templates: { id: string; name: string; disabledSiteIds?: string[] }[];
  roles: { value: string; label: string }[];
  people: {
    kind: 'USER' | 'WORKER';
    id: string;
    name: string;
    company: string;
  }[];
  selectedSiteId: string;
  canManage: boolean;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [siteFilter, setSiteFilter] = useState(selectedSiteId);

  // `monthStart` is a YYYY-MM-01 local date string, which is also exactly the
  // shape the page reads back off `?month=`.
  const year = monthStart.slice(0, 4);
  const month = monthStart.slice(5, 7);

  /**
   * Years offered. Centred on today rather than on the viewed month, so the list
   * does not walk away from the present as you browse — and the viewed year is
   * always included, so a deep link outside the range still shows its own year
   * selected instead of silently snapping somewhere else.
   */
  const years = (() => {
    const thisYear = new Date().getFullYear();
    const range = new Set<string>();
    for (let y = thisYear - 3; y <= thisYear + 3; y++) range.add(String(y));
    range.add(year);
    return [...range].sort();
  })();

  /**
   * Navigate to a month. Full navigation rather than client state: the server
   * component owns the window, and generation runs for it — the same reason the
   * prev/next arrows are links.
   */
  function goTo(m: string, y: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('month', `${y}-${m}`);
    window.location.href = url.toString();
  }

  return (
    <div className="space-y-4">
      {scheduling && (
        <ScheduleActivityForm
          sites={sites}
          templates={templates}
          roles={roles}
          people={people}
          onClose={() => setScheduling(false)}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">Compliance Calendar</h1>
          <p className="text-sm text-ink-muted">
            View and manage scheduled compliance activities
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by site"
            value={siteFilter}
            onChange={(e) => {
              setSiteFilter(e.target.value);
              const url = new URL(window.location.href);
              if (e.target.value) url.searchParams.set('site', e.target.value);
              else url.searchParams.delete('site');
              window.location.href = url.toString();
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {/* SC-020 FOLLOW-UP — jump straight to a month.
              Reaching next March meant clicking › seven times, and each click is
              a server round trip that regenerates occurrences for the window, so
              it was slow as well as tedious.
              Two selects rather than <input type="month">: Firefox has no native
              month picker and falls back to a plain text box, which would make
              the control worse for the very people who reported this.
              The arrows stay. Stepping one month is the commonest move by far
              and the picker is two interactions where the arrow is one. */}
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="calendar-month">
              Month
            </label>
            <select
              id="calendar-month"
              value={month}
              onChange={(e) => goTo(e.target.value, year)}
              className="rounded-lg border border-line bg-surface px-2 py-2 text-sm"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, '0')}>
                  {m}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="calendar-year">
              Year
            </label>
            <select
              id="calendar-year"
              value={year}
              onChange={(e) => goTo(month, e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-2 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <Link
            href={todayHref}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Today
          </Link>
          <Link
            href={prevHref}
            aria-label="Previous month"
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            ‹
          </Link>
          <Link
            href={nextHref}
            aria-label="Next month"
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            ›
          </Link>
          {canManage && (
            <button
              type="button"
              onClick={() => setScheduling(true)}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Schedule Activity
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted">
          Month
        </span>
        <h2 className="text-base font-bold text-ink">{monthLabel}</h2>
      </div>

      <ComplianceCalendar
        monthStart={monthStart}
        gridDays={gridDays}
        items={items}
        todayLocal={todayLocal}
        multiSite={!selectedSiteId}
        canManage={canManage}
      />
    </div>
  );
}
