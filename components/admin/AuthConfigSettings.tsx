'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { AuthConfigView } from '@/services/auth/authConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

/**
 * Authentication settings screen (Admin → Settings → Authentication).
 * Tunes OTP expiry, max verification attempts, session timeout and which OTP
 * channels are enabled. Values are plain (no secrets) — the current effective
 * values are shown pre-filled, with the built-in default + accepted range as
 * guidance. Saved settings are consumed at runtime by the OTP service and
 * platform session creation, so no redeploy is needed.
 */
export function AuthConfigSettings({ config }: { config: AuthConfigView }) {
  const router = useRouter();
  const [otpTtl, setOtpTtl] = useState(String(config.otpTtlSeconds));
  const [maxAttempts, setMaxAttempts] = useState(String(config.otpMaxAttempts));
  const [sessionTtl, setSessionTtl] = useState(String(config.sessionTtlSeconds));
  const [smsOtp, setSmsOtp] = useState(config.smsOtpEnabled);
  const [emailOtp, setEmailOtp] = useState(config.emailOtpEnabled);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const L = config.limits;

  async function save() {
    setBusy(true);
    setErrors({});
    setSavedMsg(undefined);
    setSaveErr(undefined);
    try {
      const res = await fetch('/api/admin/settings/authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otpTtlSeconds: otpTtl.trim(),
          otpMaxAttempts: maxAttempts.trim(),
          sessionTtlSeconds: sessionTtl.trim(),
          smsOtpEnabled: smsOtp,
          emailOtpEnabled: emailOtp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        setSaveErr(
          data.errors ? 'Fix the highlighted fields.' : data.error ?? 'Could not save. Please try again.',
        );
        return;
      }
      setSavedMsg('Authentication settings saved.');
      router.refresh();
    } catch {
      setSaveErr('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* One-time passcode (OTP) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">One-time passcodes (OTP)</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Controls the verification codes workers receive when signing in.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Code expiry"
            unit="seconds"
            value={otpTtl}
            onChange={setOtpTtl}
            error={errors.otpTtlSeconds}
            min={L.otpTtlSeconds.min}
            max={L.otpTtlSeconds.max}
            def={L.otpTtlSeconds.default}
            hint={durationHint(otpTtl)}
          />
          <NumberField
            label="Max verification attempts"
            unit="attempts"
            value={maxAttempts}
            onChange={setMaxAttempts}
            error={errors.otpMaxAttempts}
            min={L.otpMaxAttempts.min}
            max={L.otpMaxAttempts.max}
            def={L.otpMaxAttempts.default}
            hint="Wrong tries before a code locks and a new one is needed."
          />
        </div>
      </section>

      {/* Sessions */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Sessions</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          How long a platform user stays signed in before they must log in again.
          Applies to new sign-ins.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Session timeout"
            unit="seconds"
            value={sessionTtl}
            onChange={setSessionTtl}
            error={errors.sessionTtlSeconds}
            min={L.sessionTtlSeconds.min}
            max={L.sessionTtlSeconds.max}
            def={L.sessionTtlSeconds.default}
            hint={durationHint(sessionTtl)}
          />
        </div>
      </section>

      {/* Auth methods */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Authentication methods</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Which one-time passcode channels may be used to sign in.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={smsOtp}
              onChange={(e) => setSmsOtp(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line text-brand-600"
            />
            <span>
              <span className="block font-semibold text-ink">SMS one-time passcode</span>
              <span className="block text-xs text-ink-subtle">
                Codes sent by text message. Disabling this stops worker SMS sign-in.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={emailOtp}
              onChange={(e) => setEmailOtp(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line text-brand-600"
            />
            <span>
              <span className="block font-semibold text-ink">Email one-time passcode</span>
              <span className="block text-xs text-ink-subtle">
                Codes sent by email. Reserved for an upcoming release — the
                preference is stored now so it applies automatically when the
                channel ships.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Save */}
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
            <span className="text-xs text-ink-subtle">Using built-in defaults.</span>
          )}
        </div>
      </section>
    </div>
  );
}

/** Render a whole number of seconds as a friendly duration (e.g. "5 minutes"). */
function durationHint(raw: string): string {
  const s = Number(raw);
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return `= ${s} second${s === 1 ? '' : 's'}`;
  if (s < 3600) {
    const m = s / 60;
    return `≈ ${round1(m)} minute${m === 1 ? '' : 's'}`;
  }
  if (s < 86400) {
    const h = s / 3600;
    return `≈ ${round1(h)} hour${h === 1 ? '' : 's'}`;
  }
  const d = s / 86400;
  return `≈ ${round1(d)} day${d === 1 ? '' : 's'}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function NumberField({
  label,
  unit,
  value,
  onChange,
  error,
  min,
  max,
  def,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  min: number;
  max: number;
  def: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-36 rounded-xl border bg-surface px-3 py-2 text-sm text-ink',
            error ? 'border-danger-500' : 'border-line',
          )}
        />
        <span className="text-sm text-ink-subtle">{unit}</span>
        {hint && <span className="text-xs text-ink-subtle">{hint}</span>}
      </div>
      {error ? (
        <p className="text-sm font-medium text-danger-600">{error}</p>
      ) : (
        <p className="text-xs text-ink-subtle">
          Allowed {min}–{max}. Default {def}.
        </p>
      )}
    </div>
  );
}
