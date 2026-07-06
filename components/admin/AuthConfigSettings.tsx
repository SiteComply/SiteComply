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
 *
 * For readability, OTP expiry is entered in MINUTES and session timeout in HOURS;
 * both convert to/from the underlying seconds only at the edges (initial value +
 * on save), so the stored values and all backend behaviour are unchanged.
 */

// Seconds per display unit for each converted field.
const MINUTE = 60;
const HOUR = 3600;

/** Trim a number for display: integers show plain, decimals to at most 2 places. */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

const secondsToUnit = (seconds: number, factor: number) => fmtNum(seconds / factor);

interface Parsed {
  seconds?: number;
  error?: string;
}

/** Parse a user-entered value in `unit`, validate against the seconds range, and
 *  return the equivalent whole seconds (or a friendly, unit-based error). */
function parseField(
  raw: string,
  factor: number,
  limitSeconds: { min: number; max: number },
  label: string,
  unit: string,
  wholeOnly = false,
): Parsed {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (trimmed === '' || Number.isNaN(n) || !Number.isFinite(n)) {
    return { error: `${label} must be a number.` };
  }
  if (wholeOnly && !Number.isInteger(n)) {
    return { error: `${label} must be a whole number.` };
  }
  const seconds = Math.round(n * factor);
  if (seconds < limitSeconds.min || seconds > limitSeconds.max) {
    const lo = fmtNum(limitSeconds.min / factor);
    const hi = fmtNum(limitSeconds.max / factor);
    return { error: `${label} must be between ${lo} and ${hi} ${unit}.` };
  }
  return { seconds };
}

export function AuthConfigSettings({ config }: { config: AuthConfigView }) {
  const router = useRouter();
  const L = config.limits;

  // OTP expiry shown in minutes, session timeout in hours; attempts stays raw.
  const [otpMinutes, setOtpMinutes] = useState(secondsToUnit(config.otpTtlSeconds, MINUTE));
  const [maxAttempts, setMaxAttempts] = useState(String(config.otpMaxAttempts));
  const [sessionHours, setSessionHours] = useState(secondsToUnit(config.sessionTtlSeconds, HOUR));
  const [smsOtp, setSmsOtp] = useState(config.smsOtpEnabled);
  const [emailOtp, setEmailOtp] = useState(config.emailOtpEnabled);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSavedMsg(undefined);
    setSaveErr(undefined);

    // Convert the friendly inputs back to the stored seconds and validate here so
    // the messages stay in minutes/hours; the API remains the safety net.
    const otp = parseField(otpMinutes, MINUTE, L.otpTtlSeconds, 'OTP expiry', 'minutes');
    const attempts = parseField(maxAttempts, 1, L.otpMaxAttempts, 'Max verification attempts', 'attempts', true);
    const session = parseField(sessionHours, HOUR, L.sessionTtlSeconds, 'Session timeout', 'hours');

    const nextErrors: Record<string, string> = {};
    if (otp.error) nextErrors.otpTtlSeconds = otp.error;
    if (attempts.error) nextErrors.otpMaxAttempts = attempts.error;
    if (session.error) nextErrors.sessionTtlSeconds = session.error;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveErr('Fix the highlighted fields.');
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/api/admin/settings/authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otpTtlSeconds: otp.seconds,
          otpMaxAttempts: attempts.seconds,
          sessionTtlSeconds: session.seconds,
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
            unit="minutes"
            value={otpMinutes}
            onChange={setOtpMinutes}
            error={errors.otpTtlSeconds}
            min={L.otpTtlSeconds.min / MINUTE}
            max={L.otpTtlSeconds.max / MINUTE}
            def={L.otpTtlSeconds.default / MINUTE}
            step={1}
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
            step={1}
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
            unit="hours"
            value={sessionHours}
            onChange={setSessionHours}
            error={errors.sessionTtlSeconds}
            min={L.sessionTtlSeconds.min / HOUR}
            max={L.sessionTtlSeconds.max / HOUR}
            def={L.sessionTtlSeconds.default / HOUR}
            step={0.25}
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

function NumberField({
  label,
  unit,
  value,
  onChange,
  error,
  min,
  max,
  def,
  step,
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
  step: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
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
          Allowed {fmtNum(min)}–{fmtNum(max)} {unit}. Default {fmtNum(def)}.
        </p>
      )}
    </div>
  );
}
