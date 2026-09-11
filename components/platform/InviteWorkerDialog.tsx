'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

/**
 * Invite Worker — the button and its dialog, together in one client component.
 *
 * WHY THE BUTTON AND THE DIALOG LIVE TOGETHER
 *
 * They were previously split: a <Link href="?invite=1"> in the Operatives-tab
 * toolbar, and the dialog inside WorkerAccessManager, which the page renders
 * inside the collapsed "Manage project access" <details>. That arrangement had
 * three independent faults, and clicking the button did nothing at all:
 *
 *  1. A closed <details> hides every child except <summary>. `position: fixed`
 *     does NOT escape a hidden ancestor, so the dialog was rendered and then
 *     immediately hidden by the collapsed section it was nested in.
 *  2. Opening it depended on a client-side navigation to the same route, whose
 *     only observable effect was a prop change.
 *  3. That prop was consumed with `useState(autoOpenInvite)`, which reads its
 *     argument on mount only — a re-render (which is what a same-route
 *     navigation produces) left the state untouched.
 *
 * Rendering both here removes all three: the component sits in the toolbar,
 * OUTSIDE the <details>, the click sets state directly with no navigation, and
 * there is no prop to synchronise. Keep them together — splitting them is what
 * caused the failure.
 *
 * This is the ONLY invite implementation. It owns the same PATCH call, the same
 * validation and the same invitation-code result the inline form used to.
 */
export function InviteWorkerDialog({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', company: '', mobile: '' });
  const [sent, setSent] = useState<{
    name: string;
    autoApproved: boolean;
    /** Set only when the mobile already belonged to a worker. */
    existing: { fullName: string; company: string | null } | null;
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Portalled to <body>. The dialog is rendered from inside the roster's
  // toolbar, which sits inside TableSurface's `overflow-hidden` surface; a
  // portal makes the dialog independent of every ancestor — overflow, stacking
  // context, or a collapsed <details> — so it cannot be clipped or hidden by
  // wherever the button happens to live. Mount-guarded because document does
  // not exist during server rendering.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    setSent(null);
    setError(null);
    setForm({ fullName: '', company: '', mobile: '' });
  }, []);

  // Focus the first field so a manager can type immediately.
  useEffect(() => {
    if (open && !sent) nameRef.current?.focus();
  }, [open, sent]);

  // Escape closes, matching every other dismissible surface in the product.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const canSubmit =
    form.fullName.trim() !== '' &&
    form.company.trim() !== '' &&
    form.mobile.trim() !== '';

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/worker-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'invite', ...form }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not send that invitation.');
        return;
      }
      setSent({
        name: form.fullName.trim(),
        autoApproved: data.autoApproved === true,
        existing: (data.existingWorker as { fullName: string; company: string | null } | null) ?? null,
      });
      setForm({ fullName: '', company: '', mobile: '' });
      // Refresh so the roster and the assignment list pick the worker up.
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink';
  const label = 'block text-sm font-semibold text-ink';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center rounded-lg bg-safe-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-safe-600/20 hover:bg-safe-600"
      >
        Invite Operative
      </button>

      {open && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-dialog-title"
              className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/60 p-3 sm:p-6"
              onClick={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
              <div className="mt-8 w-full max-w-lg rounded-xl bg-surface p-5 shadow-card">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2
                      id="invite-dialog-title"
                      className="text-base font-bold text-ink"
                    >
                      Invite an operative
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      They receive a text with a link to sign in, and appear on
                      the roster straight away with access to this project.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-ink-subtle hover:bg-surface-sunken"
                  >
                    &times;
                  </button>
                </div>

                {error ? (
                  <p className="mb-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                    {error}
                  </p>
                ) : null}

                {sent ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                      <p className="text-sm font-semibold text-brand-700">
                        Invitation sent to {sent.existing?.fullName ?? sent.name}
                      </p>
                      <p className="mt-1 text-xs text-brand-700">
                        {sent.autoApproved
                          ? 'They have access to this project now. They still need a valid card and induction before they can check in.'
                          : 'They were previously suspended or removed from this project, so their access needs approving on the roster before they can check in.'}
                      </p>
                    </div>

                    {/*
                      The mobile was already on SiteComply. Their existing record
                      is kept — it may carry verified competency and induction
                      history — so the name and company just typed are NOT used.
                      Saying so is the whole point: discarding them silently was
                      the defect.
                    */}
                    {sent.existing ? (
                      <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
                        <p className="text-sm font-semibold text-ink">
                          This operative was already on SiteComply
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          Their existing details are used, not the ones you
                          entered:{' '}
                          <span className="font-semibold">
                            {sent.existing.fullName}
                            {sent.existing.company ? `, ${sent.existing.company}` : ''}
                          </span>
                          . This keeps their card verification and induction
                          history intact. Ask the operative to correct their details
                          when they sign in if they are wrong.
                        </p>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSent(null)}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                      >
                        Invite another
                      </button>
                      <button
                        type="button"
                        onClick={close}
                        className="rounded-lg bg-safe-500 px-3 py-2 text-sm font-semibold text-white hover:bg-safe-600"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="invite-full-name" className={label}>
                        Full name
                      </label>
                      <input
                        id="invite-full-name"
                        ref={nameRef}
                        value={form.fullName}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, fullName: e.target.value }))
                        }
                        className={field}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor="invite-company" className={label}>
                          Company
                        </label>
                        <input
                          id="invite-company"
                          value={form.company}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, company: e.target.value }))
                          }
                          className={field}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="invite-mobile" className={label}>
                          Mobile number
                        </label>
                        <input
                          id="invite-mobile"
                          value={form.mobile}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, mobile: e.target.value }))
                          }
                          placeholder="07700 900123"
                          className={field}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={close}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!canSubmit || busy}
                        onClick={submit}
                        className="rounded-lg bg-safe-500 px-3 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
                      >
                        {busy ? 'Sending…' : 'Send Invite'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
