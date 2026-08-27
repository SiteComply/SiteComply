'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MAX_CHIPS_PER_DAY,
  OCCURRENCE_STATUS_LABEL,
  activityColour,
  type OccurrenceStatusValue,
} from '@/services/compliance/complianceConstants';

/**
 * SC-020 Phase 1 — the Compliance Calendar month grid, the PRIMARY experience.
 *
 * Follows the REV-1 example closely: Mon-Sun columns, adjacent-month days greyed,
 * today ringed, colour-coded activity chips carrying a time, and a "+N more"
 * overflow per day. The chip colour comes from the activity type (the audit
 * template) via the validated SC-014 palette, keyed on the template id — so
 * filtering the calendar never repaints the survivors.
 *
 * A list/register is deliberately NOT the main surface; selecting a day opens a
 * detail panel beneath the grid rather than navigating away from the calendar.
 */

export interface CalendarItem {
  id: string;
  templateId: string;
  title: string;
  dueDateLocal: string;
  timeOfDay: string;
  status: OccurrenceStatusValue;
  siteName: string;
  assigneeLabel: string;
  auditId: string | null;
  overdue: boolean;
  escalatedAt: string | null;
  escalatedToRole: string | null;
  workerNotNotified: boolean;
}

export function ComplianceCalendar({
  monthStart,
  gridDays,
  items,
  todayLocal,
  multiSite,
  canManage,
}: {
  /** yyyy-mm-01 of the displayed month. */
  monthStart: string;
  /** All local dates in the grid, Monday-aligned, usually 42. */
  gridDays: string[];
  items: CalendarItem[];
  todayLocal: string;
  multiSite: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const month = monthStart.slice(0, 7);
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const list = byDay.get(it.dueDateLocal) ?? [];
    list.push(it);
    byDay.set(it.dueDateLocal, list);
  }

  async function act(occurrenceId: string, action: 'start' | 'complete') {
    setBusyId(occurrenceId);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/compliance/occurrences/${occurrenceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        auditId?: string | null;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not update that activity.');
        return;
      }
      if (action === 'start' && data.auditId) {
        router.push(`/platform/dashboard/audits/${data.auditId}`);
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];

  // Summary strip — what actually needs attention, above the grid.
  const overdueCount = items.filter(
    (i) => i.overdue && i.status !== 'COMPLETED',
  ).length;
  const escalatedCount = items.filter((i) => i.escalatedAt).length;
  const dueSoonCount = items.filter(
    (i) => !i.overdue && i.status !== 'COMPLETED' && isDueSoon(i, todayLocal),
  ).length;

  return (
    <div className="space-y-3">
      {(overdueCount > 0 || escalatedCount > 0 || dueSoonCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {escalatedCount > 0 && (
            <span className="rounded-full bg-danger-600 px-3 py-1 font-semibold text-white">
              {escalatedCount} escalated
            </span>
          )}
          {overdueCount > 0 && (
            <span className="rounded-full bg-danger-50 px-3 py-1 font-semibold text-danger-700">
              {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="rounded-full bg-hivis-400/25 px-3 py-1 font-semibold text-ink">
              {dueSoonCount} due soon
            </span>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <div className="min-w-[52rem]">
          {/* Weekday header — Monday first, as in the example. */}
          <div className="grid grid-cols-7 border-b border-line">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-subtle"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const inMonth = day.slice(0, 7) === month;
              const isToday = day === todayLocal;
              const dayItems = byDay.get(day) ?? [];
              const shown = dayItems.slice(0, MAX_CHIPS_PER_DAY);
              const extra = dayItems.length - shown.length;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelected(day === selected ? null : day)}
                  aria-label={`${day}, ${dayItems.length} activities`}
                  className={`min-h-[6.5rem] border-b border-r border-line p-1.5 text-left align-top transition ${
                    inMonth ? 'bg-surface' : 'bg-surface-sunken/60'
                  } ${day === selected ? 'ring-2 ring-inset ring-brand-500' : 'hover:bg-brand-50/40'}`}
                >
                  <span
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday
                        ? 'bg-brand-600 text-white'
                        : inMonth
                          ? 'text-ink'
                          : 'text-ink-subtle'
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </span>

                  <span className="block space-y-1">
                    {shown.map((it) => (
                      <span
                        key={it.id}
                        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          it.status === 'COMPLETED'
                            ? 'bg-surface-sunken text-ink-subtle line-through'
                            : it.escalatedAt
                              ? 'bg-danger-600 text-white'
                              : it.overdue
                                ? 'bg-danger-50 text-danger-700'
                                : isDueSoon(it, todayLocal)
                                  ? 'bg-hivis-400/25 text-ink'
                                  : 'bg-surface-sunken text-ink'
                        }`}
                        title={`${it.title} · ${it.timeOfDay} · ${it.assigneeLabel}`}
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: activityColour(it.templateId),
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {it.escalatedAt && (
                            <span aria-hidden className="mr-0.5">
                              ▲
                            </span>
                          )}
                          {it.title}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-subtle">
                          {it.timeOfDay}
                        </span>
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="block px-1 text-[11px] font-semibold text-brand-700">
                        + {extra} more
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Day detail — stays under the calendar so the calendar remains the
          experience rather than handing off to a list view. */}
      {selected && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">
              {new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm font-medium text-ink-subtle hover:underline"
            >
              Close
            </button>
          </div>

          {selectedItems.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              No compliance activities scheduled for this day.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {selectedItems.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: activityColour(it.templateId) }}
                  />
                  <span className="text-sm font-semibold text-ink">
                    {it.title}
                  </span>
                  <span className="text-sm tabular-nums text-ink-muted">
                    {it.timeOfDay}
                  </span>
                  {multiSite && (
                    <span className="text-xs text-ink-subtle">
                      {it.siteName}
                    </span>
                  )}
                  <span className="text-xs text-ink-subtle">
                    Assigned to {it.assigneeLabel}
                    {it.workerNotNotified && ' — not notified'}
                  </span>
                  {it.escalatedAt && (
                    <span className="whitespace-nowrap rounded-full bg-danger-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                      Escalated to {it.escalatedToRole ?? 'management'} on{' '}
                      {new Date(it.escalatedAt).toLocaleDateString('en-GB')}
                    </span>
                  )}
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      it.overdue && it.status !== 'COMPLETED'
                        ? 'bg-danger-50 text-danger-700'
                        : 'bg-surface-sunken text-ink-muted'
                    }`}
                  >
                    {it.overdue && it.status !== 'COMPLETED'
                      ? 'Overdue'
                      : OCCURRENCE_STATUS_LABEL[it.status]}
                  </span>

                  <span className="ml-auto flex items-center gap-2">
                    {it.auditId && (
                      <Link
                        href={`/platform/dashboard/audits/${it.auditId}`}
                        className="text-xs font-semibold text-brand-700 hover:underline"
                      >
                        Open audit
                      </Link>
                    )}
                    {canManage && !it.auditId && it.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        disabled={busyId === it.id}
                        onClick={() => act(it.id, 'start')}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {busyId === it.id ? 'Starting…' : 'Start'}
                      </button>
                    )}
                    {canManage && it.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        disabled={busyId === it.id}
                        onClick={() => act(it.id, 'complete')}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                      >
                        Mark complete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Due within the next 3 days (and not yet due) — the calendar's amber state. */
function isDueSoon(item: CalendarItem, todayLocal: string): boolean {
  if (item.status === 'COMPLETED') return false;
  const days = Math.round(
    (new Date(`${item.dueDateLocal}T12:00:00Z`).getTime() -
      new Date(`${todayLocal}T12:00:00Z`).getTime()) /
      86400000,
  );
  return days >= 0 && days <= 3;
}
