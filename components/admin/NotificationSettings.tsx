'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  type NotificationChannelKey,
} from '@/services/notifications/notificationCatalog';
import type { NotificationConfigView } from '@/services/notifications/notificationConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

type TypeState = { enabled: boolean; channels: Record<NotificationChannelKey, boolean> };

/**
 * Platform notification settings (Admin → Settings → Notifications). Data-driven
 * from the notification catalogue: each type has a master enable toggle plus
 * per-channel (email / SMS) delivery preferences. Delivery channels are declared
 * ahead of implementation — the preference is stored now and applies when the
 * channel launches. Current settings are shown pre-filled; no secrets involved.
 */
export function NotificationSettings({ config }: { config: NotificationConfigView }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, TypeState>>(() => {
    const s: Record<string, TypeState> = {};
    for (const t of NOTIFICATION_TYPES) {
      const cur = config.types[t.key];
      s[t.key] = {
        enabled: cur?.enabled ?? t.defaultEnabled,
        channels: {
          email: cur?.channels.email ?? t.defaultChannels.email,
          sms: cur?.channels.sms ?? t.defaultChannels.sms,
        },
      };
    }
    return s;
  });
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function setEnabled(key: string, enabled: boolean) {
    setState((s) => ({ ...s, [key]: { ...s[key], enabled } }));
  }
  function setChannel(key: string, channel: NotificationChannelKey, on: boolean) {
    setState((s) => ({
      ...s,
      [key]: { ...s[key], channels: { ...s[key].channels, [channel]: on } },
    }));
  }

  async function save() {
    setBusy(true);
    setSavedMsg(undefined);
    setSaveErr(undefined);
    try {
      const res = await fetch('/api/admin/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types: state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setSaveErr(data.error ?? 'Could not save. Please try again.');
        return;
      }
      setSavedMsg('Notification settings saved.');
      router.refresh();
    } catch {
      setSaveErr('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Platform notifications</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Turn each notification on or off and choose how it will be delivered.
          Email and SMS delivery are coming soon — set your preference now and it
          applies automatically once each channel launches.
        </p>

        <div className="mt-4 divide-y divide-line">
          {NOTIFICATION_TYPES.map((t) => {
            const st = state[t.key];
            return (
              <div key={t.key} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">{t.label}</h3>
                    <p className="mt-0.5 text-xs text-ink-subtle">{t.description}</p>
                  </div>
                  <Toggle
                    checked={st.enabled}
                    onChange={(v) => setEnabled(t.key, v)}
                    label={`Enable ${t.label}`}
                  />
                </div>

                {/* Delivery channels — only relevant when the type is enabled. */}
                <div
                  className={cn(
                    'mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 pl-0.5',
                    st.enabled ? '' : 'pointer-events-none opacity-40',
                  )}
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Deliver via
                  </span>
                  {NOTIFICATION_CHANNELS.map((ch) => (
                    <label key={ch.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={st.channels[ch.key]}
                        disabled={!st.enabled}
                        onChange={(e) => setChannel(t.key, ch.key, e.target.checked)}
                        className="h-4 w-4 rounded border-line text-brand-600"
                      />
                      <span className="text-ink">{ch.label}</span>
                      {!ch.available && (
                        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                          coming soon
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        {saveErr && (
          <p className="mb-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
            {saveErr}
          </p>
        )}
        {savedMsg && (
          <p className="mb-3 rounded-lg border border-safe-500 bg-safe-50 px-3 py-2 text-sm font-medium text-safe-700">
            {savedMsg}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-xl bg-safe-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-safe-600 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          {config.updatedAt ? (
            <span className="text-xs text-ink-subtle">
              Last updated {formatDateTimeUK(config.updatedAt)}
              {config.updatedByName ? ` by ${config.updatedByName}` : ''}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">Using default settings.</span>
          )}
        </div>
      </section>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-safe-500' : 'bg-line',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
