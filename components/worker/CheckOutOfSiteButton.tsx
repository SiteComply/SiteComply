'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { WorkerIcon } from './icons';

/**
 * "Check out of site" — the Worker Dashboard's primary exit action (SC-003).
 *
 * Distinct from the confirmation screen's button in one respect: because the
 * dashboard only exists while a check-in is open, ending the check-in here would
 * bounce the worker to the site selector. Instead we send them to their check-in
 * confirmation, which renders its checked-out state and doubles as their receipt.
 */
export function CheckOutOfSiteButton({
  submissionId,
  className,
}: {
  submissionId: string;
  className?: string;
}) {
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
      router.push(`/check-in/confirmation/${submissionId}`);
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={cn(
          'touch-target inline-flex items-center justify-center gap-2 rounded-xl border-2 border-danger-500 px-4 py-2.5 text-sm font-semibold text-danger-600 transition-colors hover:bg-danger-50',
          className,
        )}
      >
        <WorkerIcon name="logout" className="h-4 w-4" />
        Check out of site
      </button>

      <ConfirmDialog
        open={confirming}
        title="Are you sure you want to check out?"
        message="This records that you’re leaving site and ends your attendance for today."
        confirmLabel={busy ? 'Checking out…' : 'Check out'}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={checkOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
