'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/platform/Panel';
import { useToast } from '@/components/ui/Toast';
import type { PlatformNotificationSettingsView } from '@/services/notifications/notificationConfigService';

/**
 * Settings → Notifications.
 *
 * Grouped by the thing being notified about — Actions, Permits, Audits,
 * Compliance activities, Documents — plus reminder timing and delivery.
 *
 * EVERY SWITCH HERE DOES SOMETHING. The groups are built from the catalogue,
 * and the catalogue now holds exactly the types that reach an enforcement
 * point. Three that reached none were removed rather than shown as controls
 * that changed nothing.
 *
 * WHAT IS NOT HERE IS SIMPLY NOT HERE. An earlier revision listed the thirteen
 * requested notifications that do not exist yet, and named in-app as the only
 * delivery channel. Both were removed: a configuration screen should contain
 * things you can act on, and a roadmap rendered as a panel is neither
 * actionable nor a setting. What cannot be configured does not belong on a
 * page whose job is configuring.
 *
 * The principle is unchanged — only enforced settings appear. This goes one
 * step further and stops explaining the absences here.
 */

/**
 * Which panel each catalogue key belongs to.
 *
 * Keyed off the catalogue rather than a `group` field on the descriptor: the
 * grouping is a presentation decision belonging to this screen, and putting it
 * in the catalogue would make every future consumer carry it. A key with no
 * entry falls into "Other", so adding a type can never make it disappear.
 */
const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: 'Actions',
    hint: 'Corrective actions raised on your sites.',
    keys: ['action_assigned', 'action_updated', 'action_due_reminders', 'overdue_actions'],
  },
  {
    title: 'Permits',
    hint: 'Permits to work submitted on your sites.',
    keys: ['permit_awaiting'],
  },
  {
    title: 'Audits',
    hint: 'Audits and inspections.',
    keys: ['audit_created', 'audit_signed_off'],
  },
  {
    title: 'Compliance activities',
    hint: 'Scheduled compliance work.',
    keys: ['compliance_reminders', 'compliance_overdue', 'compliance_escalation'],
  },
  {
    title: 'Documents',
    hint: 'Certificates and documents with an expiry date.',
    keys: ['document_expiry'],
  },
];

export function NotificationSettingsWorkspace({
  settings,
  canEdit,
}: {
  settings: PlatformNotificationSettingsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [types, setTypes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(settings.types.map((t) => [t.key, t.enabled])),
  );
  const [actionDueDays, setActionDueDays] = useState(
    settings.thresholds.actionDueDays,
  );
  const [documentExpiryDays, setDocumentExpiryDays] = useState(
    settings.thresholds.documentExpiryDays,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byKey = new Map(settings.types.map((t) => [t.key, t]));
  const grouped = GROUPS.map((g) => ({
    ...g,
    entries: g.keys.map((k) => byKey.get(k)).filter(Boolean),
  })).filter((g) => g.entries.length > 0);

  // Anything the catalogue has that this screen did not place. Shown rather
  // than dropped, so a new type is never silently invisible.
  const placed = new Set(GROUPS.flatMap((g) => g.keys));
  const other = settings.types.filter((t) => !placed.has(t.key));

  const touch = () => {
    setNotice(null);
    setError(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/platform/notification-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ types, actionDueDays, documentExpiryDays }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not save these settings.');
        return;
      }
      setNotice('Notification settings saved.');
      toast.success('Notification settings saved.');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-sunken px-1 py-3">
          <p className="text-xs text-ink-subtle">
            {settings.updatedByName && settings.updatedAt
              ? `Last changed by ${settings.updatedByName} on ${new Date(
                  settings.updatedAt,
                ).toLocaleDateString('en-GB')}.`
              : 'Not yet configured — the values shown are the platform defaults.'}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save notifications'}
          </button>
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-muted">
          You can see these settings but not change them. Only a Director can
          change what SiteComply notifies people about.
        </p>
      )}
      {error ? (
        <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-safe-500/40 bg-safe-50 px-4 py-2 text-sm text-safe-700">
          {notice}
        </p>
      ) : null}

      {grouped.map((g) => (
        <Panel key={g.title} title={g.title} hint={g.hint}>
          {g.entries.map((t) => (
            <Toggle
              key={t!.key}
              label={t!.label}
              hint={t!.description}
              checked={types[t!.key] ?? true}
              disabled={!canEdit}
              onChange={(v) => {
                touch();
                setTypes((s) => ({ ...s, [t!.key]: v }));
              }}
            />
          ))}
        </Panel>
      ))}

      {other.length > 0 ? (
        <Panel title="Other" hint="Notification types not yet grouped.">
          {other.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              hint={t.description}
              checked={types[t.key] ?? true}
              disabled={!canEdit}
              onChange={(v) => {
                touch();
                setTypes((s) => ({ ...s, [t.key]: v }));
              }}
            />
          ))}
        </Panel>
      ) : null}

      <Panel
        title="Reminder timing"
        hint="How far ahead a reminder starts appearing. Applies across the organisation."
      >
        <Days
          label="Action due reminders"
          hint="Reminders begin this many days before an action is due, and repeat closer to the date."
          value={actionDueDays}
          min={settings.thresholdLimits.actionDueDays.min}
          max={settings.thresholdLimits.actionDueDays.max}
          disabled={!canEdit}
          onChange={(v) => {
            touch();
            setActionDueDays(v);
          }}
        />
        <Days
          label="Document expiry reminders"
          hint="Reminders begin this many days before a document expires."
          value={documentExpiryDays}
          min={settings.thresholdLimits.documentExpiryDays.min}
          max={settings.thresholdLimits.documentExpiryDays.max}
          disabled={!canEdit}
          onChange={(v) => {
            touch();
            setDocumentExpiryDays(v);
          }}
        />
        {/* Escalation is deliberately absent here. It already exists PER
            SCHEDULE (Compliance → schedule → escalate after N days), and an
            organisation-wide value would either duplicate that or silently
            override a choice someone made per activity. Making it a default for
            NEW schedules is a different feature and belongs with that screen. */}
        <p className="mt-2 text-xs text-ink-subtle">
          Compliance escalation is set per schedule, on the activity itself, so
          it is not duplicated here.
        </p>
      </Panel>

    </div>
  );
}

function Days({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} in days`}
          className="w-20 rounded-lg border border-line bg-surface px-3 py-1.5 text-right text-sm text-ink disabled:opacity-50"
        />
        <span className="text-xs text-ink-subtle">
          days
          <span className="block text-[11px]">
            {min}–{max}
          </span>
        </span>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? 'bg-brand-600' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
