'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { CSCS_CARD_OPTIONS } from '@/lib/cscs';

export interface IdentityInitial {
  fullName: string;
  company: string;
  cscsCardNumber: string;
  cscsCardType: string;
  cscsExpiry: string; // yyyy-mm-dd or ''
}

const DRAFT_KEY = 'sitecomply.checkin.identity';

/**
 * Identity capture step. Pre-fills from a recognised worker (server) or, failing
 * that, from a locally-saved draft — so a dropped connection mid-induction
 * doesn't make the worker retype anything. Name + company are required; CSCS
 * card details are optional.
 */
export function IdentityForm({
  initial,
  recognised,
}: {
  initial: IdentityInitial;
  recognised: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<IdentityInitial>(initial);
  const [showCscs, setShowCscs] = useState(
    Boolean(initial.cscsCardNumber || initial.cscsCardType),
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Restore a local draft if the server didn't already recognise the worker.
  useEffect(() => {
    if (recognised) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as Partial<IdentityInitial>;
        setForm((f) => ({ ...f, ...draft }));
        if (draft.cscsCardNumber || draft.cscsCardType) setShowCscs(true);
      }
    } catch {
      /* ignore malformed drafts */
    }
  }, [recognised]);

  // Persist the draft on every change so progress survives a reload/lost signal.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, [form]);

  function update<K extends keyof IdentityInitial>(
    key: K,
    value: IdentityInitial[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/worker/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      router.push('/check-in/site');
    } catch {
      setError('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      {recognised && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-ink">
          Welcome back — we’ve filled in your details. Check they’re still
          correct.
        </p>
      )}

      <TextField
        label="Full name"
        autoComplete="name"
        autoCapitalize="words"
        autoFocus={!recognised}
        placeholder="e.g. Jordan Smith"
        value={form.fullName}
        onChange={(e) => update('fullName', e.target.value)}
      />

      <TextField
        label="Company"
        autoComplete="organization"
        placeholder="Your employer or subcontractor"
        value={form.company}
        onChange={(e) => update('company', e.target.value)}
        error={error}
      />

      <div className="rounded-xl border border-line bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowCscs((s) => !s)}
          aria-expanded={showCscs}
        >
          <span className="text-sm font-semibold text-ink">
            CSCS card details{' '}
            <span className="font-normal text-ink-subtle">(optional)</span>
          </span>
          <span className="text-ink-subtle">{showCscs ? '−' : '+'}</span>
        </button>

        {showCscs && (
          <div className="space-y-4 border-t border-line p-4">
            <TextField
              label="CSCS card number"
              inputMode="numeric"
              placeholder="e.g. 8841201"
              value={form.cscsCardNumber}
              onChange={(e) => update('cscsCardNumber', e.target.value)}
            />
            <div className="space-y-1.5">
              <label
                htmlFor="cscsCardType"
                className="block text-sm font-semibold text-ink"
              >
                Card type
              </label>
              <select
                id="cscsCardType"
                className="touch-target w-full rounded-xl border border-line bg-surface px-4 py-3 text-lg text-ink"
                value={form.cscsCardType}
                onChange={(e) => update('cscsCardType', e.target.value)}
              >
                <option value="">Select card type…</option>
                {CSCS_CARD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label="Expiry date"
              type="date"
              value={form.cscsExpiry}
              onChange={(e) => update('cscsExpiry', e.target.value)}
            />
          </div>
        )}
      </div>

      <Button type="submit" size="lg" fullWidth disabled={busy}>
        {busy ? 'Saving…' : 'Continue to site selection'}
      </Button>
    </form>
  );
}
