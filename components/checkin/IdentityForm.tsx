'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { CSCS_CARD_OPTIONS } from '@/lib/cscs';

export interface IdentityInitial {
  fullName: string;
  company: string;
  cscsCardNumber: string;
  cscsCardType: string;
  cscsExpiry: string; // yyyy-mm-dd or ''
}

/** Client-safe shape of the Smart Check outcome returned by the profile API. */
interface VerificationView {
  status: string;
  verified: boolean;
  scheme: string | null;
  holderName: string | null;
  message: string;
  qualifications: { title: string; detail?: string }[];
}

const DRAFT_KEY = 'sitecomply.checkin.identity';

/**
 * Identity capture step. Pre-fills from a recognised worker (server) or, failing
 * that, from a locally-saved draft — so a dropped connection mid-induction
 * doesn't make the worker retype anything. Name + company are required; CSCS/ECS
 * card details are optional. When a card number is supplied it is verified against
 * the CSCS Smart Check service on save (SC-001) and the result is shown here; a
 * card photo can be uploaded or taken as supporting evidence.
 */
export function IdentityForm({
  initial,
  recognised,
}: {
  initial: IdentityInitial;
  recognised: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<IdentityInitial>(initial);
  const [showCscs, setShowCscs] = useState(
    Boolean(initial.cscsCardNumber || initial.cscsCardType),
  );
  const [cardImage, setCardImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationView | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  // (The card image is not persisted — files can't live in localStorage.)
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, [form]);

  // Manage the preview object URL lifecycle.
  useEffect(() => {
    if (!cardImage) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(cardImage);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cardImage]);

  function update<K extends keyof IdentityInitial>(
    key: K,
    value: IdentityInitial[K],
  ) {
    // Any edit invalidates a prior verification result — re-verify on next save.
    setSaved(false);
    setVerification(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSaved(false);
    setVerification(null);
    setCardImage(file);
  }

  function removeImage() {
    setCardImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submit() {
    // Second press after a verification result is shown → just continue.
    if (saved) {
      router.push('/check-in/site');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('fullName', form.fullName);
      fd.append('company', form.company);
      fd.append('cscsCardNumber', form.cscsCardNumber);
      fd.append('cscsCardType', form.cscsCardType);
      fd.append('cscsExpiry', form.cscsExpiry);
      if (cardImage) fd.append('cscsCardImage', cardImage);

      const res = await fetch('/api/worker/profile', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      const v = data.verification as VerificationView | null;
      if (v) {
        setVerification(v);
        setSaved(true);
        if (v.verified) toast.success('CSCS card verified.');
        else toast.error(v.message ?? 'Card could not be verified.');
        return; // let the worker see the Smart Check result before continuing
      }

      toast.success('Details saved.');
      router.push('/check-in/site');
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const hasCardNumber = form.cscsCardNumber.trim().length > 0;
  const buttonLabel = busy
    ? 'Saving…'
    : saved
      ? 'Continue to site selection'
      : hasCardNumber
        ? 'Verify card & continue'
        : 'Continue to site selection';

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
      />

      <div className="rounded-xl border border-line bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowCscs((s) => !s)}
          aria-expanded={showCscs}
        >
          <span className="text-sm font-semibold text-ink">
            CSCS / ECS card details{' '}
            <span className="font-normal text-ink-subtle">(optional)</span>
          </span>
          <span className="text-ink-subtle">{showCscs ? '−' : '+'}</span>
        </button>

        {showCscs && (
          <div className="space-y-4 border-t border-line p-4">
            <TextField
              label="Card number"
              // Accept numerical AND alphanumeric card numbers (SC-001).
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. 8841201 or ECS1027633"
              value={form.cscsCardNumber}
              onChange={(e) =>
                update('cscsCardNumber', e.target.value.toUpperCase())
              }
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

            {/* Upload or photograph the card (SC-001). */}
            <div className="space-y-1.5">
              <span className="block text-sm font-semibold text-ink">
                Card photo{' '}
                <span className="font-normal text-ink-subtle">(optional)</span>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPickImage}
              />
              {imagePreview ? (
                <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Selected card"
                    className="h-16 w-24 rounded-lg border border-line object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {cardImage?.name}
                    </p>
                    <div className="mt-1 flex gap-3 text-sm font-semibold">
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="text-ink-subtle hover:underline"
                        onClick={removeImage}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="touch-target flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-sm font-semibold text-brand-700"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span aria-hidden="true">📷</span> Upload or photograph card
                </button>
              )}
              <p className="text-xs text-ink-subtle">
                We’ll verify your card against the CSCS Smart Check service.
              </p>
            </div>

            {verification && <VerificationBanner verification={verification} />}
          </div>
        )}
      </div>

      <Button type="submit" size="lg" fullWidth disabled={busy}>
        {buttonLabel}
      </Button>
    </form>
  );
}

/** Shows the CSCS Smart Check outcome after a save. */
function VerificationBanner({
  verification,
}: {
  verification: VerificationView;
}) {
  const ok = verification.verified;
  return (
    <div
      className={
        'rounded-xl border px-4 py-3 text-sm ' +
        (ok
          ? 'border-safe-500/40 bg-safe-50 text-ink'
          : 'border-hivis-400/50 bg-hivis-400/15 text-ink')
      }
      role="status"
    >
      <p className="font-semibold">
        {ok ? '✓ Card verified' : '⚠ Card not verified'}
        {verification.scheme ? ` · ${verification.scheme}` : ''}
      </p>
      <p className="mt-0.5 text-ink-muted">{verification.message}</p>
      {ok && verification.qualifications.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-ink-muted">
          {verification.qualifications.map((q, i) => (
            <li key={i}>
              • {q.title}
              {q.detail ? ` — ${q.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
