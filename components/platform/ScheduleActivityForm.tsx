'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FREQUENCIES,
  TIME_OPTIONS,
  WEEKDAYS,
  type FrequencyValue,
} from '@/services/compliance/complianceConstants';

/**
 * SC-020 Phase 1 — the "+ Schedule Activity" workflow from the REV-1 example.
 *
 * Assignment supports an INDIVIDUAL or a ROLE, because the example shows both
 * ("Assigned to John Smith" alongside "Assigned to Fire Marshal"). Role
 * assignment resolves to whoever holds that role on the site at the time, which
 * is what makes "All Supervisors"-style assignment work without naming people.
 *
 * Reminder and escalation inputs are captured here and stored now; Phase 2 acts
 * on them. Collecting them up front means no migration and no re-visit later.
 */
export function ScheduleActivityForm({
  sites,
  templates,
  roles,
  people,
  onClose,
}: {
  sites: { id: string; name: string }[];
  templates: { id: string; name: string; disabledSiteIds?: string[] }[];
  roles: { value: string; label: string }[];
  people: {
    kind: 'USER' | 'WORKER';
    id: string;
    name: string;
    company: string;
  }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [jobSiteId, setJobSiteId] = useState(sites[0]?.id ?? '');

  // SC-021 — only the activity types the chosen site actually uses. Computed
  // from the chosen site rather than fetched, so switching site is instant.
  const availableTemplates = templates.filter(
    (t) => !(t.disabledSiteIds ?? []).includes(jobSiteId),
  );

  const [auditTemplateId, setTemplateId] = useState(
    availableTemplates[0]?.id ?? '',
  );
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<FrequencyValue>('WEEKLY');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [intervalDays, setIntervalDays] = useState(7);
  const [timeOfDay, setTimeOfDay] = useState('08:00');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [dueWindowDays, setDueWindowDays] = useState(1);
  const [assigneeKind, setAssigneeKind] = useState<'ROLE' | 'USER' | 'WORKER'>(
    'ROLE',
  );
  const [assignedRole, setAssignedRole] = useState(roles[0]?.value ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [reminders, setReminders] = useState('3,1');
  const [escalateAfterDays, setEscalateAfter] = useState('');
  const [escalateToRole, setEscalateTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleWeekday(d: number) {
    setWeekdays((w) =>
      w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort(),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/compliance/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobSiteId,
          auditTemplateId,
          title,
          frequency,
          weekdays:
            frequency === 'WEEKLY' || frequency === 'DAILY' ? weekdays : [],
          dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : null,
          intervalDays: frequency === 'CUSTOM' ? intervalDays : null,
          timeOfDay,
          startDate,
          endDate: endDate || null,
          dueWindowDays,
          assigneeKind,
          assignedRole: assigneeKind === 'ROLE' ? assignedRole : null,
          assigneeId: assigneeKind === 'ROLE' ? null : assigneeId,
          reminderOffsetsDays: reminders
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n >= 0),
          escalateAfterDays: escalateAfterDays
            ? Number(escalateAfterDays)
            : null,
          escalateToRole: escalateToRole || null,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not create the schedule.');
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const label = 'block text-sm font-semibold text-ink';
  const field =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Schedule activity"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/60 p-3 sm:p-6"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Schedule activity</h2>
            <p className="text-xs text-ink-subtle">
              Recurring compliance activities generate automatically from the
              start date onward.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Cancel
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className={label}>Site</label>
            <select
              className={field}
              value={jobSiteId}
              onChange={(e) => {
                const nextSiteId = e.target.value;
                setJobSiteId(nextSiteId);
                // SC-021: if the new site doesn't use the chosen activity type,
                // move to one it does rather than leaving a selection the
                // server will reject after the round trip.
                const stillAvailable = templates.some(
                  (t) =>
                    t.id === auditTemplateId &&
                    !(t.disabledSiteIds ?? []).includes(nextSiteId),
                );
                if (!stillAvailable) {
                  const next = templates.find(
                    (t) => !(t.disabledSiteIds ?? []).includes(nextSiteId),
                  );
                  setTemplateId(next?.id ?? '');
                }
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={label}>Activity type</label>
            <select
              className={field}
              value={auditTemplateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {availableTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-subtle">
              Starting an activity creates an audit from this template.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className={label}>Title (optional)</label>
            <input
              className={field}
              value={title}
              placeholder="Defaults to the activity type name"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className={label}>Frequency</label>
            <select
              className={field}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as FrequencyValue)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-subtle">
              {FREQUENCIES.find((f) => f.value === frequency)?.hint}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className={label}>Time</label>
            <select
              className={field}
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {(frequency === 'WEEKLY' || frequency === 'DAILY') && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className={label}>
                {frequency === 'DAILY'
                  ? 'Limit to days (leave all off for every day)'
                  : 'Days of the week'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={weekdays.includes(d.value)}
                    onClick={() => toggleWeekday(d.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      weekdays.includes(d.value)
                        ? 'border-brand-500 bg-brand-600 text-white'
                        : 'border-line text-ink-muted hover:bg-surface-sunken'
                    }`}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </div>
          )}

          {frequency === 'MONTHLY' && (
            <div className="space-y-1.5">
              <label className={label}>Day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                className={field}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)}
              />
              <p className="text-xs text-ink-subtle">
                Day 31 falls back to the last day in shorter months.
              </p>
            </div>
          )}

          {frequency === 'CUSTOM' && (
            <div className="space-y-1.5">
              <label className={label}>Repeat every (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                className={field}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value) || 1)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className={label}>Start date</label>
            <input
              type="date"
              className={field}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className={label}>End date (optional)</label>
            <input
              type="date"
              className={field}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className={label}>Completion window (days)</label>
            <input
              type="number"
              min={0}
              max={90}
              className={field}
              value={dueWindowDays}
              onChange={(e) => setDueWindowDays(Number(e.target.value) || 0)}
            />
          </div>

          <div className="space-y-1.5">
            <label className={label}>Assign to</label>
            <select
              className={field}
              value={assigneeKind}
              onChange={(e) =>
                setAssigneeKind(e.target.value as 'ROLE' | 'USER' | 'WORKER')
              }
            >
              <option value="ROLE">A role</option>
              <option value="USER">A specific platform user</option>
              <option value="WORKER">A specific worker</option>
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            {assigneeKind === 'ROLE' ? (
              <>
                <label className={label}>Role</label>
                <select
                  className={field}
                  value={assignedRole}
                  onChange={(e) => setAssignedRole(e.target.value)}
                >
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-subtle">
                  Resolves to whoever holds this role on the site at the time.
                </p>
              </>
            ) : (
              <>
                <label className={label}>Person</label>
                <select
                  className={field}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">Select a person</option>
                  {people
                    .filter((p) => p.kind === assigneeKind)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.company}
                      </option>
                    ))}
                </select>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <label className={label}>Reminders (days before)</label>
            <input
              className={field}
              value={reminders}
              placeholder="e.g. 3,1"
              onChange={(e) => setReminders(e.target.value)}
            />
            <p className="text-xs text-ink-subtle">
              Comma-separated. A reminder is sent on each of these days before the
              activity is due.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className={label}>Escalate after (days overdue)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className={field}
                value={escalateAfterDays}
                onChange={(e) => setEscalateAfter(e.target.value)}
              />
              <select
                className={field}
                value={escalateToRole}
                onChange={(e) => setEscalateTo(e.target.value)}
              >
                <option value="">No escalation</option>
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Scheduling…' : 'Schedule activity'}
          </button>
          <p className="text-xs text-ink-subtle">
            Activities are generated from the start date onward — no history is
            created for past dates.
          </p>
        </div>
      </div>
    </div>
  );
}
