'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

/**
 * "Check in" for a worker whose site induction is still valid (SC-006). Records
 * an express attendance check-in (reusing the valid induction) and lands on the
 * Worker Dashboard — no induction wizard, no knowledge check.
 */
export function ExpressCheckInButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function checkIn() {
    setBusy(true);
    try {
      const res = await fetch('/api/worker/express-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'We couldn’t check you in. Please try again.',
        );
        // If the induction is no longer valid, fall back to the full induction.
        router.refresh();
        return;
      }
      toast.success('You’re checked in.');
      router.push('/worker/dashboard');
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="lg" fullWidth onClick={checkIn} disabled={busy}>
      {busy ? 'Checking you in…' : 'Check in to site'}
    </Button>
  );
}
