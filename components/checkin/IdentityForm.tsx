'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { CSCS_CARD_OPTIONS } from '@/lib/cscs';
import {
  CSCS_SCHEMES,
  schemesAreUsable,
  SCHEME_LIST_EXHAUSTIVE,
  SCHEME_NOT_LISTED,
} from '@/services/cscs/schemes';
import { firstNameRepeatsSurname } from '@/services/workers/workerName';

export interface IdentityInitial {
  /** Given name. The display name is derived from this plus the surname. */
  firstName: string;
  /** Family name, captured separately. Never derived from fullName. */
  surname: string;
  company: string;
  cscsCardNumber: string;
  cscsCardType: string;
  /** Smart Check scheme id, chosen from CSCS_SCHEMES. Never free text. */
  cscsSchemeId: string;
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
  verificationLive,
  checkName = false,
}: {
  initial: IdentityInitial;
  recognised: boolean;
  /**
   * The record cannot say which part of the name is the surname - typically an
   * operative invited before invitations asked for the two parts separately,
   * whose whole name is in the First name box. See nameNeedsChecking().
   */
  checkName?: boolean;
  /** Whether a real CSCS check will actually run on save. */
  verificationLive: boolean;
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
  // Set once the operative has been told their first name already ends with
  // their surname. A second press saves as typed: it is their name.
  const [repeatWarned, setRepeatWarned] = useState(false);
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
    if (key === 'firstName' || key === 'surname') setRepeatWarned(false);
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

    /*
     * Told BEFORE the round trip, and with the card section open where the
     * missing field lives there.
     *
     * The server enforces the same rules, but a rejection that arrives as a
     * banner after submit — on a phone, at a site gate, with the card fields
     * collapsed out of view — is a worker who does not know which box to fill.
     */
    if (!form.firstName.trim()) {
      toast.error('Please enter your first name.');
      return;
    }
    /*
     * A FIRST NAME THAT ENDS WITH THE SURNAME would be saved as "Jordan Smith
     * Smith" on every register, report, signature and PDF. It is what an old
     * invitation led to: the whole name offered as the first name, the surname
     * then typed into the empty box. Asked once, not refused - a second press
     * saves exactly what was typed.
     */
    if (!repeatWarned && firstNameRepeatsSurname(form.firstName, form.surname)) {
      setRepeatWarned(true);
      toast.error('Your first name already ends with your surname.');
      return;
    }
    /*
     * The surname is asked for only when there is a card to check. It is a
     * person's attribute and sits in the personal section, but it is not
     * something an operative without a card needs to supply.
     */
    if (
      (form.cscsCardNumber.trim() || form.cscsSchemeId.trim()) &&
      !form.surname.trim()
    ) {
      setShowCscs(true);
      toast.error('Please enter your surname so your card can be checked.');
      return;
    }
    if (form.cscsCardNumber.trim()) {
      if (schemesAreUsable() && !form.cscsSchemeId.trim()) {
        setShowCscs(true);
        toast.error('Please choose the scheme that issued your card.');
        return;
      }
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('firstName', form.firstName);
      fd.append('surname', form.surname);
      fd.append('company', form.company);
      fd.append('cscsCardNumber', form.cscsCardNumber);
      fd.append('cscsCardType', form.cscsCardType);
      fd.append('cscsSchemeId', form.cscsSchemeId);
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
        else if (v.status === 'UNVERIFIED') {
          /*
           * NOT A FAILURE. "Your scheme is not one we can check automatically"
           * and "checking is switched off" are normal outcomes for a card that
           * was accepted and stored. In danger-red they read as a rejection at
           * the gate, which is what the operative is anxious about.
           */
          toast.success(v.message ?? 'Card details recorded.');
        } else toast.error(v.message ?? 'Card could not be verified.');
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
      : // CSCS cutover Phase 1 — "Verify card" is a promise too. Do not make it
        // when no verification is going to run.
        hasCardNumber && verificationLive
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
      {recognised && !checkName && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-ink">
          Welcome back — we’ve filled in your details. Check they’re still
          correct.
        </p>
      )}
      {recognised && checkName && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-ink">
          We’ve filled in your details. Please check your name: put your first
          name in <span className="font-semibold">First name</span> and your
          surname in <span className="font-semibold">Surname</span>.
        </p>
      )}

      {/* First name and surname, asked separately.
          Asking for a full name AND a surname asked most people for their
          surname twice, and put a person's own name under a heading about
          their card. The display name is derived from these two on save. */}
      <TextField
        label="First name"
        autoComplete="given-name"
        autoCapitalize="words"
        autoFocus={!recognised}
        placeholder="e.g. Jordan"
        value={form.firstName}
        onChange={(e) => update('firstName', e.target.value)}
        error={
          repeatWarned
            ? `This already ends with “${form.surname.trim()}”. Remove your surname from this box, or press continue again if this is correct.`
            : undefined
        }
      />

      {/* Surname, ASKED rather than derived.
            CSCS Smart Check looks a card up by scheme + surname + registration
            number. "The last word of the full name" is wrong for compound
            surnames and for names written family-name-first, and a wrong surname
            comes back "not found" — which at a site gate reads as a rejected
            card. One extra field beats turning a competent worker away. */}
      <TextField
        label="Surname"
        autoComplete="family-name"
        autoCapitalize="words"
        placeholder="e.g. Smith"
        hint="Needed to check a CSCS or ECS card."
        value={form.surname}
        onChange={(e) => update('surname', e.target.value)}
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
            {/* Card scheme.
                Only offered once the documented scheme list is in: a picker with
                one entry implies the others do not exist, and would send an ECS
                or CPCS holder looking for a scheme that is missing only because
                we have not typed it in yet. Until then the card is still
                captured and simply stays unverified — see schemes.ts. */}
            {schemesAreUsable() ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="cscsSchemeId"
                  className="block text-sm font-semibold text-ink"
                >
                  Card scheme
                </label>
                <select
                  id="cscsSchemeId"
                  className="touch-target w-full rounded-xl border border-line bg-surface px-4 py-3 text-lg text-ink"
                  value={form.cscsSchemeId}
                  onChange={(e) => update('cscsSchemeId', e.target.value)}
                >
                  <option value="">Select card scheme…</option>
                  {CSCS_SCHEMES.map((scheme) => (
                    <option key={scheme.id} value={scheme.id}>
                      {scheme.name}
                    </option>
                  ))}
                  {/* The list holds 17 of the 38 CSCS Alliance schemes, so a
                      holder of one of the others needs an answer that is
                      true. Without it they picked a scheme that
                      did not issue their card and were told it was not found. */}
                  {!SCHEME_LIST_EXHAUSTIVE && (
                    <option value={SCHEME_NOT_LISTED}>
                      My scheme is not listed
                    </option>
                  )}
                </select>
                <p className="text-xs text-ink-subtle">
                  The scheme that issued your card. Needed to check it against
                  CSCS.{' '}
                  {!SCHEME_LIST_EXHAUSTIVE && (
                    <>
                      If yours is not listed, choose “My scheme is not listed” —
                      your card is still recorded, it just will not be checked
                      automatically.
                    </>
                  )}
                </p>
              </div>
            ) : null}

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
              {/* CSCS cutover Phase 1 — this promised a Smart Check to every
                  operative, including while the mock provider was active and
                  checking nothing. */}
              <p className="text-xs text-ink-subtle">
                {form.cscsSchemeId === SCHEME_NOT_LISTED
                  ? 'Your card is recorded with your check-in. We cannot check this scheme automatically, so your site manager will confirm it.'
                  : verificationLive
                    ? 'We’ll verify your card against the CSCS Smart Check service.'
                    : 'Your card details are recorded with your check-in. Automatic CSCS checking is not switched on yet.'}
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

/** Shows the card-check outcome after a save. */
function VerificationBanner({
  verification,
}: {
  verification: VerificationView;
}) {
  const ok = verification.verified;
  // UNVERIFIED means "no check was run", which is not the same as a card that
  // failed one. An amber "not verified" for it reads as a problem with the
  // operative's card when the only thing missing is the integration.
  const notChecked = !ok && verification.status === 'UNVERIFIED';
  return (
    <div
      className={
        'rounded-xl border px-4 py-3 text-sm ' +
        (ok
          ? 'border-safe-500/40 bg-safe-50 text-ink'
          : notChecked
            ? 'border-line bg-surface-sunken text-ink'
            : 'border-hivis-400/50 bg-hivis-400/15 text-ink')
      }
      role="status"
    >
      <p className="font-semibold">
        {ok
          ? '✓ Card verified'
          : notChecked
            ? 'Card details recorded'
            : '⚠ Card not verified'}
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
