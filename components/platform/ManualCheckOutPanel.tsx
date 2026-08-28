'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

/**
 * BL-001 — the authorised manual check-out control.
 *
 * Deliberately NOT a modal. The established pattern for a mandatory reason in
 * this product is the inline disclosure used by project reopen: click the
 * action, a bordered panel opens in place with a labelled field, the primary
 * button stays disabled until the reason is non-empty, and a plain Cancel
 * closes it. `ConfirmDialog` cannot host a field — it takes only a `message`
 * string — and an overlay would reintroduce the `fixed inset-0` trap that made
 * "Invite Worker" silently do nothing inside a clipping ancestor.
 *
 * The button is rendered only for a permitted role; the API re-checks anyway,
 * because a hidden button is not an access control.
 */
export function ManualCheckOutPanel({
  submissionId,
  workerName,
  openSinceLabel,
}: {
  submissionId: string;
  workerName: string;
  /** e.g. "Open since 23/07/2026 · 36 days." — context for the decision. */
  openSinceLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/platform/submissions/${submissionId}/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not check this worker out.');
        return;
      }
      toast.success(`${workerName} has been checked out.`);
      setOpen(false);
      setReason('');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink"
        >
          Check this worker out…
        </button>
        {openSinceLabel ? (
          <p className="mt-1 text-xs text-ink-subtle">{openSinceLabel}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-semibold text-ink">
          Why are you checking {workerName} out?
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="e.g. Left site without checking out; confirmed with the site supervisor"
          className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </label>
      <p className="mt-1 text-xs text-ink-subtle">
        Recorded against your name and role, and shown on the attendance record.
        The original check-in time is not changed.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || reason.trim() === ''}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? 'Checking out…' : 'Check out worker'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 text-sm font-semibold text-ink-subtle"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
