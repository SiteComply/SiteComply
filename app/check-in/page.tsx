'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type Step = 'phone' | 'code';

/**
 * Worker SMS one-time passcode (MFA) screen.
 *
 * Two mobile-first steps: enter your UK mobile, then the code we text you.
 * Large numeric inputs, SMS autofill support, and a resend with cooldown.
 */
export default function CheckInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [maskedMobile, setMaskedMobile] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const codeInputRef = useRef<HTMLInputElement>(null);

  // Count down the resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/worker/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        if (data.resendInSeconds) setResendIn(data.resendInSeconds);
        return;
      }
      setMaskedMobile(data.maskedMobile ?? '');
      setDevCode(data.devCode);
      setResendIn(data.resendInSeconds ?? 30);
      setStep('code');
      setCode('');
      setTimeout(() => codeInputRef.current?.focus(), 50);
    } catch {
      setError('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/worker/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'That code didn’t work. Please try again.');
        return;
      }
      // MFA passed — continue into identity & site selection (Stage 4).
      router.push('/check-in/details');
    } catch {
      setError('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      {step === 'phone' ? (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) sendCode();
          }}
        >
          <header className="space-y-2">
            <h1 className="text-2xl font-bold text-ink">Site check-in</h1>
            <p className="text-ink-muted">
              Enter your mobile number and we’ll text you a code to verify it’s
              you.
            </p>
          </header>

          <TextField
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="07700 900123"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            hint="A UK mobile, starting 07."
            error={error}
          />

          <Button type="submit" size="lg" fullWidth disabled={busy}>
            {busy ? 'Sending code…' : 'Send my code'}
          </Button>

          <p className="text-center text-xs text-ink-subtle">
            We use your number only to verify you and record your site check-in,
            in line with UK GDPR.
          </p>
        </form>
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) verify();
          }}
        >
          <header className="space-y-2">
            <h1 className="text-2xl font-bold text-ink">Enter your code</h1>
            <p className="text-ink-muted">
              We’ve sent a 6-digit code to{' '}
              <span className="font-semibold text-ink">{maskedMobile}</span>.
            </p>
          </header>

          {devCode && (
            <p className="rounded-xl border border-hivis-500 bg-hivis-400/20 px-4 py-3 text-sm text-ink">
              <strong>Dev mode:</strong> your code is{' '}
              <span className="font-mono font-bold">{devCode}</span>.
            </p>
          )}

          <TextField
            ref={codeInputRef}
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="••••••"
            className="text-center text-3xl font-bold tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            error={error}
          />

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={busy || code.length !== 6}
          >
            {busy ? 'Verifying…' : 'Verify and continue'}
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="font-semibold text-brand-700"
              onClick={() => {
                setStep('phone');
                setError(undefined);
                setCode('');
              }}
            >
              Change number
            </button>
            <button
              type="button"
              className="font-semibold text-brand-700 disabled:text-ink-subtle"
              disabled={resendIn > 0 || busy}
              onClick={sendCode}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
