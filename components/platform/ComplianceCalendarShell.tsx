'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ComplianceCalendar,
  type CalendarItem,
} from '@/components/platform/ComplianceCalendar';
import { ScheduleActivityForm } from '@/components/platform/ScheduleActivityForm';
import { MonthPicker } from '@/components/platform/MonthPicker';

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
   * Navigate to a month, `YYYY-MM`. Full navigation rather than client state:
   * the server component owns the window, and generation runs for it — the same
   * reason the prev/next arrows are links. Other query params (the site filter)
   * ride along untouched.
   */
  function goTo(month: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('month', month);
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
          {/* ONE control that both states the period and changes it. It began as
              prev/next arrows alone (seven clicks to reach next March), then a
              Month select beside a Year select — which worked, but split one
              decision across two controls and told you where you were only if
              you read both. The arrows stay: stepping one month is the commonest
              move and an arrow is a single click. */}
          <MonthPicker
            value={`${year}-${month}`}
            currentMonth={todayLocal.slice(0, 7)}
            onSelect={goTo}
          />
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

      {/* The "Month" chip and the repeated month label are gone: the date
          selector above now states the period, and saying it twice on one screen
          was the redundancy. The heading stays for structure and for anyone
          navigating by headings — visually hidden, because it would otherwise be
          the same words a few pixels below the button. */}
      <h2 className="sr-only">{monthLabel}</h2>

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
