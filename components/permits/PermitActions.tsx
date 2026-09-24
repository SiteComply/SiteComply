'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/**
 * Worker permit actions: open the permit as a document, and cancel it while it
 * is still cancellable.
 *
 * THE PERMIT IS A SERVER-RENDERED PDF, not a browser print of this screen. A
 * printed web page carries the reader's own browser header and footer - the
 * page title, the URL, the date their device thinks it is - onto a document
 * that authorises work, and no stylesheet can remove them because they come
 * from a checkbox in each reader's print dialog. The same reason the
 * construction phase plan and the induction record stopped doing it.
 *
 * It opens in a NEW TAB rather than downloading: this is shown to whoever asks
 * at a work face, and a file that lands in a phone's Files app has to be found
 * again first.
 */
export function PermitActions({
  permitId,
  canCancel,
}: {
  permitId: string;
  canCancel: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/worker/permits/${permitId}/cancel`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not cancel this permit.');
        return;
      }
      toast.success('Permit cancelled.');
      setConfirm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 print:hidden">
      <Link
        href={`/api/worker/permits/${permitId}/record`}
        target="_blank"
        rel="noopener"
        className="touch-target flex w-full items-center justify-center rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink hover:bg-surface-sunken"
      >
        View permit (PDF)
      </Link>
      {canCancel && (
        <Button
          variant="danger"
          fullWidth
          onClick={() => setConfirm(true)}
          disabled={busy}
        >
          Cancel permit
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        title="Cancel this permit?"
        message="You’ll need to request a new permit if you still need to do the work."
        confirmLabel={busy ? 'Cancelling…' : 'Cancel permit'}
        cancelLabel="Keep permit"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
