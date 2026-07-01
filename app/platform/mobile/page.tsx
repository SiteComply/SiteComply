'use client';

import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { cn } from '@/lib/cn';

type Step = 'mobile' | 'code';
type Notice = { tone: 'pending' | 'error'; text: string };

/**
 * Platform Login — mobile method.
 *
 * Validates against Platform Users: "Send code" checks the account exists and is
 * ACTIVE (Pending → awaiting approval, Disabled → access revoked). Active users
 * continue with the development code (no real SMS is sent). Role and
 * Assigned-Sites permissions are NOT enforced yet.
 */
function noticeFor(reason: string): Notice {
  switch (reason) {
    case 'pending':
      return {
        tone: 'pending',
        text: 'Your platform account is awaiting approval. You’ll be able to sign in once an administrator approves it.',
      };
    case 'disabled':
      return {
        tone: 'error',
        text: 'Your access has been revoked. Please contact your administrator.',
      };
    case 'not_found':
      return {
        tone: 'error',
        text: 'We couldn’t find an active platform account for that mobile number.',
      };
    default:
      return { tone: 'error', text: 'Please enter a valid UK mobile number.' };
  }
}

export default function PlatformMobileLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const res = await fetch('/api/platform/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'mobile', value: mobile }),
      });
      const data = await res.json();
      if (data.ok) {
        setDevCode(data.code);
        setCode('');
        setCodeError(undefined);
        setStep('code');
        setTimeout(() => codeInputRef.current?.focus(), 50);
      } else {
        setNotice(noticeFor(data.reason));
      }
    } catch {
      setNotice({ tone: 'error', text: 'Network problem. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function continueWithCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCodeError(undefined);
    try {
      const res = await fetch('/api/platform/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'mobile', value: mobile, code }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push('/platform/dashboard');
        router.refresh();
      } else {
        setCodeError(data.error ?? 'That code didn’t work. Please try again.');
      }
    } catch {
      setCodeError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-sm space-y-6 py-8">
        {step === 'mobile' ? (
          <>
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-bold text-ink">Login with Mobile</h1>
              <p className="text-ink-muted">
                Enter your mobile number and we’ll text you a verification code.
              </p>
            </div>

            {notice && <NoticeBox notice={notice} />}

            <form className="space-y-4" onSubmit={sendCode}>
              <TextField
                label="Mobile number"
                type="tel"
                name="mobile"
                autoComplete="tel"
                inputMode="tel"
                placeholder="07700 900123"
                hint="Use the mobile number registered to your platform account."
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
              <Button
                type="submit"
                size="lg"
                variant="brand"
                fullWidth
                disabled={busy}
              >
                {busy ? 'Checking…' : 'Send code'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-bold text-ink">Login with Mobile</h1>
              <p className="text-ink-muted">
                Enter the 6-digit code we sent to{' '}
                <span className="font-semibold text-ink">
                  {mobile || 'your mobile'}
                </span>
                .
              </p>
            </div>

            {devCode && (
              <p className="rounded-xl border border-hivis-500 bg-hivis-400/20 px-4 py-3 text-sm text-ink">
                <strong>Dev mode:</strong> your code is{' '}
                <span className="font-mono font-bold">{devCode}</span>.
              </p>
            )}

            <form className="space-y-4" onSubmit={continueWithCode}>
              <TextField
                ref={codeInputRef}
                label="Verification code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••••"
                className="text-center text-3xl font-bold tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                error={codeError}
              />
              <Button
                type="submit"
                size="lg"
                variant="brand"
                fullWidth
                disabled={busy || code.length !== 6}
              >
                {busy ? 'Signing in…' : 'Continue'}
              </Button>
            </form>

            <p className="text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep('mobile');
                  setCodeError(undefined);
                  setCode('');
                }}
                className="font-semibold text-brand-700"
              >
                ← Use a different number
              </button>
            </p>
          </>
        )}

        <p className="text-center text-xs text-ink-subtle">
          <Link href="/platform" className="font-semibold text-brand-700">
            ← Other sign-in options
          </Link>
        </p>
      </div>
    </AppShell>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-xl border px-4 py-3 text-sm',
        notice.tone === 'pending'
          ? 'border-hivis-500 bg-hivis-400/20 text-ink'
          : 'border-danger-500 bg-danger-50 font-medium text-danger-700',
      )}
    >
      {notice.text}
    </p>
  );
}
