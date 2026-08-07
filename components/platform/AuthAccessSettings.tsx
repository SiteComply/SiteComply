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
      {/* THE WORKSPACE ACTION BAR.
          Save used to sit under the last panel, which on this page means below
          four regions — a Director changing the first toggle had to scroll past
          everything they had not touched to commit it. It now leads the
          workspace and STAYS on screen, which is the actual requirement: a
          header action would scroll away on a page this tall and leave the user
          exactly where they started.
          Read-only viewers get the notice in the same slot, so the answer to
          "can I change this" is in one place for both roles.

          bg-surface-sunken is the PAGE background (PlatformShell), not a
          decorative choice — a sticky bar without it lets the panels scroll
          through the text. There is no bg-surface-page token; naming one that
          does not exist fails silently and only shows up mid-scroll. */}
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
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-muted">
          You can see these settings but not change them. Only a Director can
          change how people sign in or who may reach a site.
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

      <Panel
        title="Login methods"
        hint="How people sign in to this organisation."
      >
        <Toggle
          label="Worker SMS Login"
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

      {/* READ-ONLY, AND IT HAS TO LOOK IT.
          These three rows already rendered as static chips, but so does the
          SMS delivery row above them, and nothing on the panel said WHY none
          of them could be changed — a Director could reasonably read it as a
          section that had failed to load its controls. The badge states the
          rule once, at the level it applies to, so the rows below need no
          repeated disclaimer. */}
      <Panel
        title="OTP settings"
        hint="One-time code behaviour. These values apply to this organisation but are not set here."
        actions={<ManagedElsewhereBadge />}
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

    </div>
  );
}

/** Says once, at panel level, that a whole region is set somewhere else. */
function ManagedElsewhereBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3 w-3 fill-current"
      >
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
      </svg>
      Managed in the Admin Centre
    </span>
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
 * The durations offered for a session timeout, in SECONDS.
 *
 * A number-of-minutes box asked the wrong question. "480" is not a length of
 * time anyone reasons about, it needs mental arithmetic to become "8 hours",
 * and it invited values nobody wants — 7 minutes, 1,000 minutes — that then
 * had to be clamped server-side. These are the choices that actually get made.
 */
const DURATION_CHOICES: { seconds: number; label: string }[] = [
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 7200, label: '2 hours' },
  { seconds: 14400, label: '4 hours' },
  { seconds: 28800, label: '8 hours' },
  { seconds: 43200, label: '12 hours' },
  { seconds: 86400, label: '24 hours' },
];

/**
 * A timeout, chosen as a duration and stored in seconds exactly as before.
 *
 * NOTHING ABOUT THE STORED VALUE CHANGES. The same integer seconds go to the
 * same field, through the same validation and the same clamp.
 *
 * The list is filtered to each field's own range, so the worker timeout cannot
 * offer a length the server would reject. And a value that is NOT one of these
 * — set previously through the API, or arriving from an env var — is added to
 * the list and preselected rather than silently rounded to the nearest option.
 * Presenting choices must not quietly rewrite a setting the moment somebody
 * opens the page and saves it.
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
  const options = DURATION_CHOICES.filter(
    (c) => c.seconds >= min && c.seconds <= max,
  );
  const known = options.some((c) => c.seconds === seconds);
  const all = known
    ? options
    : [
        { seconds, label: `${formatDuration(seconds)} (current)` },
        ...options,
      ].sort((a, b) => a.seconds - b.seconds);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      <select
        value={seconds}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-50"
      >
        {all.map((c) => (
          <option key={c.seconds} value={c.seconds}>
            {c.label}
          </option>
        ))}
      </select>
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
