'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

/**
 * Manual check-out control for the Worker Details "Current site" card. Shown only
 * to authorised roles (Director / Project Manager — gated server-side before this
 * renders). Opening it requires a confirmation step and a MANDATORY reason before
 * the check-out can be submitted. On success the page refreshes so every derived
 * figure (on-site count, dashboard metrics, history, reports) reflects it at once.
 */
export function ManualCheckOutButton({
  submissionId,
  workerName,
  siteName,
}: {
  submissionId: string;
  workerName: string;
  siteName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) reasonRef.current?.focus();
  }, [open]);

  function close() {
    if (busy) return;
    setOpen(false);
    setReason('');
    setError(undefined);
  }

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/submissions/${submissionId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not check the worker out. Please try again.');
        return;
      }
      setOpen(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        Check out worker
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            className="w-full max-w-md animate-pop-in rounded-2xl border border-line bg-surface p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="checkout-title" className="text-lg font-bold leading-snug text-ink">
              Check out {workerName}?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              This ends their check-in at <span className="font-semibold">{siteName}</span>{' '}
              now. The original check-in time is kept, and this action — with your
              name, the time and the reason — is recorded in the audit trail.
            </p>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-semibold text-ink">
                Reason <span className="text-danger-600">*</span>
              </span>
              <textarea
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Worker left site without checking out"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-danger-600">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <Button variant="secondary" size="md" fullWidth onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                fullWidth
                onClick={submit}
                disabled={busy || reason.trim() === ''}
              >
                {busy ? 'Checking out…' : 'Confirm check-out'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
