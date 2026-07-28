'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/**
 * Worker permit actions (SC-009): print the permit (browser print-to-PDF, so it
 * can be shown on site) and cancel it while it is still cancellable. No
 * server-generated PDF in v1 — the print dialog covers "available on site".
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
      <Button variant="secondary" fullWidth onClick={() => window.print()}>
        View / print permit
      </Button>
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
