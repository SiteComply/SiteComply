'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

/**
 * "Close permit" as a HEADER action, alongside the record's other actions —
 * the placement Audit Detail already uses for Edit audit / Configure scoring.
 *
 * It used to be the only thing inside a "Review" panel in the bottom of the
 * summary rail on an approved or expired permit: a bordered panel, a heading and
 * a hint, wrapped around one button. Single-purpose panels like that are exactly
 * what the workspace refactor set out to remove, and a reviewer looking for the
 * action expects it with the record's other actions rather than at the foot of a
 * column of facts.
 *
 * BEHAVIOUR IS UNCHANGED and deliberately so: same PATCH, same body, same
 * success and failure toasts, same router.refresh(), same disabled-while-saving.
 * The server enforces the permits "edit" permission exactly as before — this
 * component asserts nothing about permissions and adds no gate of its own, and
 * the caller renders it on precisely the condition that used to reveal the
 * button (the permit being closable).
 */
export function PermitCloseButton({ permitId }: { permitId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function close() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/permits/${permitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update the permit.');
        return;
      }
      toast.success('Permit closed.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={close}
      disabled={busy}
      className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? 'Closing…' : 'Close permit'}
    </button>
  );
}
