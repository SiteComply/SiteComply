'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/**
 * "Check out" affordance shown on the confirmation screen while the worker is
 * still on site. Marks their check-in as checked out, then refreshes so the
 * confirmation re-renders in its checked-out state.
 */
export function CheckOutButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function checkOut() {
    setBusy(true);
    try {
      const res = await fetch('/api/worker/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not check you out. Please try again.');
        return;
      }
      toast.success('You’ve checked out. Stay safe.');
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={() => setConfirming(true)}
      >
        Check out
      </Button>

      <ConfirmDialog
        open={confirming}
        title="Are you sure you want to check out?"
        message="This records that you’re leaving site."
        confirmLabel={busy ? 'Checking out…' : 'Check out'}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={checkOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
