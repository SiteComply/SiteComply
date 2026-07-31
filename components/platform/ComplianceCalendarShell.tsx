'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ComplianceCalendar,
  type CalendarItem,
} from '@/components/platform/ComplianceCalendar';
import { ScheduleActivityForm } from '@/components/platform/ScheduleActivityForm';

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
          {/* SC-021 Phase 2 — a SECONDARY action, styled to match the Audits
              page's Templates link. The calendar stays the primary experience;
              this is another quiet destination alongside the schedules
              register, not a competing surface. */}
          <Link
            href="/platform/dashboard/compliance-calendar/config-templates"
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken"
          >
            Configuration templates
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
