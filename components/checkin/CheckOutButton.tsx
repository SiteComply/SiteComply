'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

/**
 * "Check out" affordance shown on the confirmation screen while the worker is
 * still on site. Marks their check-in as checked out, then refreshes so the
 * confirmation re-renders in its checked-out state.
 */
export function CheckOutButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function checkOut() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch('/api/worker/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not check you out. Please try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={checkOut}
        disabled={busy}
      >
        {busy ? 'Checking out…' : 'Check out (leaving site)'}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
