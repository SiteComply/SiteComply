'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { WorkerIcon } from './icons';
import { captureLocation } from '@/lib/clientGeolocation';

/**
 * "Check out of site" — the Worker Dashboard's primary exit action (SC-003).
 *
 * On success it returns the worker to their worker home (SC-004): if they are
 * still checked into another site, home forwards to that site's dashboard; if
 * not, home keeps them signed in with continued access instead of dropping them
 * out of the app. The check-out receipt stays reachable from home under "recent
 * check-ins". `router.refresh()` clears the now-stale dashboard from the cache.
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
      // SC-007: record the check-out location if already permitted (never blocks).
      const location = await captureLocation({ onlyIfGranted: true });
      const res = await fetch('/api/worker/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, location }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not check you out. Please try again.');
        return;
      }
      toast.success('You’ve checked out. Stay safe.');
      setConfirming(false);
      router.push('/worker');
      router.refresh();
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
