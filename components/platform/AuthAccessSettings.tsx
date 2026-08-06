'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/platform/Panel';
import type { PlatformAuthSettingsView } from '@/services/auth/authConfigService';

/**
 * Settings → Authentication & Access.
 *
 * Four regions in one workspace — Login methods, Session security, OTP settings,
 * Access controls — rendered through the shared `Panel` so this reads like the
 * rest of Settings rather than inventing its own chrome.
 *
 * EVERY CONTROL HERE DOES SOMETHING. Each one is wired to an enforcement point
 * in the running product, and the two read-only regions say plainly why they are
 * read-only rather than looking broken:
 *   - OTP timings belong to the Admin Centre (they protect the system, not one
 *     organisation), so they are shown for context and cannot be edited here.
 *   - OTP length is env-configured and not yet editable from either portal.
 *
 * A Project Manager sees this screen with every control disabled. That is a
 * courtesy, not the permission — the API refuses their save regardless.
 */
export function AuthAccessSettings({
  settings,
  canEdit,
}: {
  settings: PlatformAuthSettingsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    sessionTtlSeconds: settings.sessionTtlSeconds,
    workerSessionTtlSeconds: settings.workerSessionTtlSeconds,
    workerSmsLoginEnabled: settings.workerSmsLoginEnabled,
    expressCheckInEnabled: settings.expressCheckInEnabled,
    invitedWorkersOnly: settings.invitedWorkersOnly,
    requireActiveSiteAssignment: settings.requireActiveSiteAssignment,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
    setError(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/platform/auth-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not save these settings.');
        return;
      }
      setNotice('Authentication and access settings saved.');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <p className="rounded-lg border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-muted">
          You can see these settings but not change them. Only a Director can
          change how people sign in or who may reach a site.
        </p>
      ) : null}
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

      <Panel
        title="Login methods"
        hint="How people sign in to this organisation."
      >
        <Toggle
          label="SMS login for workers"
          hint="Workers sign in with a one-time code sent by text. Turning this off stops codes being sent — workers cannot sign in until it is back on."
          checked={form.workerSmsLoginEnabled}
          disabled={!canEdit}
          onChange={(v) => set('workerSmsLoginEnabled', v)}
        />
        <Toggle
          label="Express check-in"
          hint="Lets a worker with a still-valid induction check in without repeating the wizard. Turning it off requires the full check-in everywhere."
          checked={form.expressCheckInEnabled}
          disabled={!canEdit}
          onChange={(v) => set('expressCheckInEnabled', v)}
        />
        <DeliveryRow settings={settings} />
      </Panel>

      <Panel
        title="Session security"
        hint="How long someone stays signed in before they must authenticate again."
      >
        <Duration
          label="Platform session timeout"
          hint="Applies to everyone signing in to the Platform portal."
          seconds={form.sessionTtlSeconds}
          min={settings.limits.sessionTtlSeconds.min}
          max={settings.limits.sessionTtlSeconds.max}
          disabled={!canEdit}
          onChange={(v) => set('sessionTtlSeconds', v)}
        />
        <Duration
          label="Worker session timeout"
          hint="Applies to workers on site. Usually shorter — a worker session is a shared-device credential."
          seconds={form.workerSessionTtlSeconds}
          min={settings.limits.workerSessionTtlSeconds.min}
          max={settings.limits.workerSessionTtlSeconds.max}
          disabled={!canEdit}
          onChange={(v) => set('workerSessionTtlSeconds', v)}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          Changing a timeout applies to sessions created from now on. Anyone
          already signed in keeps the session they have until it expires.
        </p>
      </Panel>

      <Panel
        title="OTP settings"
        hint="One-time code behaviour. Managed in the Admin Centre — shown here so you can see what applies."
      >
        <ReadOnlyRow
          label="Code length"
          value={`${settings.otpLength} digits`}
          note="Set by environment configuration; not editable from either portal yet."
        />
        <ReadOnlyRow
          label="Code expiry"
          value={formatDuration(settings.otpTtlSeconds)}
          note="How long a code stays valid after it is sent."
        />
        <ReadOnlyRow
          label="Maximum verification attempts"
          value={`${settings.otpMaxAttempts} attempts`}
          note="Wrong-code attempts before a challenge locks."
        />
      </Panel>

      <Panel
        title="Access controls"
        hint="The minimum standard for reaching a site, across the whole organisation."
      >
        <Toggle
          label="Invited workers only"
          hint="A worker must have been invited to a project before they can check in — on every site, including those not enforcing access themselves."
          checked={form.invitedWorkersOnly}
          disabled={!canEdit}
          onChange={(v) =>
            setForm((f) => ({
              ...f,
              invitedWorkersOnly: v,
              // The stricter rule cannot stand on its own: an active assignment
              // is an assignment. Clearing the base rule clears it too, rather
              // than leaving a combination the access check cannot express and
              // the server would reject on save.
              requireActiveSiteAssignment: v
                ? f.requireActiveSiteAssignment
                : false,
            }))
          }
        />
        <Toggle
          label="Require an active site assignment"
          hint="Stricter: the invitation must also be approved and within its access dates. Requires “Invited workers only”."
          checked={form.requireActiveSiteAssignment}
          disabled={!canEdit || !form.invitedWorkersOnly}
          onChange={(v) => set('requireActiveSiteAssignment', v)}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          These set a floor. A site already enforcing worker access keeps its
          own stricter rules — switching these on can only narrow who gets in,
          never widen it.
        </p>
      </Panel>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {settings.updatedByName && settings.updatedAt ? (
            <p className="text-xs text-ink-subtle">
              Last changed by {settings.updatedByName} on{' '}
              {new Date(settings.updatedAt).toLocaleDateString('en-GB')}.
            </p>
          ) : (
            <p className="text-xs text-ink-subtle">
              Not yet configured — the values shown are the platform defaults.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Seconds rendered the way a person would say them. */
function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const d = seconds / 86400;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (seconds % 3600 === 0) {
    const h = seconds / 3600;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * A timeout in MINUTES, stored in seconds. Nobody thinks about a session in
 * seconds, and the stored unit is not the user's problem.
 */
function Duration({
  label,
  hint,
  seconds,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  seconds: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (seconds: number) => void;
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
          min={Math.round(min / 60)}
          max={Math.round(max / 60)}
          value={Math.round(seconds / 60)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value) * 60)}
          aria-label={`${label} in minutes`}
          className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-right text-sm text-ink disabled:opacity-50"
        />
        <span className="text-xs text-ink-subtle">
          minutes
          <span className="block text-[11px]">
            {Math.round(min / 60)}–{Math.round(max / 60)}
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

/** A value this portal shows but does not own. Says so, rather than looking broken. */
function ReadOnlyRow({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note: string;
  /** 'warn' when the value means something is not working as intended. */
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{note}</p>
      </div>
      <span
        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
          tone === 'warn'
            ? 'bg-hivis-400/25 text-ink ring-1 ring-inset ring-hivis-500'
            : 'bg-surface-sunken text-ink-muted'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * What is ACTUALLY delivering sign-in codes.
 *
 * This row replaces "SMS one-time codes: Available", which reported the
 * channel flag and nothing else. That reading stayed reassuring the whole time
 * production was running the console mock: the flag was on, no text was ever
 * sent, and the codes were being handed back in the API response instead.
 *
 * So the row now answers the question a Director is really asking — will a
 * worker receive a text — and orders the checks the way the send path fails:
 * the channel switch, then the master outbound switch, then the provider
 * itself. The first thing that is wrong is the thing shown, because listing
 * three green ticks above one red cross is how a red cross gets missed.
 */
function DeliveryRow({ settings }: { settings: PlatformAuthSettingsView }) {
  const { smsDelivery: d } = settings;

  if (!settings.smsOtpEnabled) {
    return (
      <ReadOnlyRow
        label="SMS delivery"
        value="Switched off"
        tone="warn"
        note="One-time codes are turned off in the Admin Centre, so worker SMS login cannot work whatever the setting above says."
      />
    );
  }
  if (!d.sendingEnabled) {
    return (
      <ReadOnlyRow
        label="SMS delivery"
        value="Sending paused"
        tone="warn"
        note="Outbound SMS is paused in the Admin Centre. Codes are recorded but never sent, so workers cannot sign in."
      />
    );
  }
  if (d.isMock) {
    return (
      <ReadOnlyRow
        label="SMS delivery"
        value="Not delivering"
        tone="warn"
        note="No real text messages are being sent — the placeholder provider is active, which is intended for development only. Workers cannot receive a sign-in code. A real provider must be configured in the Admin Centre."
      />
    );
  }
  if (!d.isKnownProvider) {
    return (
      <ReadOnlyRow
        label="SMS delivery"
        value="Misconfigured"
        tone="warn"
        note={`The configured provider "${d.providerId}" is not one this system can use, so no code can be sent. Correct it in the Admin Centre.`}
      />
    );
  }
  return (
    <ReadOnlyRow
      label="SMS delivery"
      value={d.providerName}
      note="The provider currently sending sign-in codes. Managed in the Admin Centre — shown here because every worker login setting above depends on it."
    />
  );
}
