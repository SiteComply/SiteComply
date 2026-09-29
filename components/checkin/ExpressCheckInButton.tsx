'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  LocationCheck,
  type ConfirmLocation,
} from '@/components/checkin/LocationCheck';

/**
 * "Check in" for a worker whose site induction is still valid (SC-006). Runs the
 * SC-007 GPS Location Check first (which resolves instantly on GPS-off sites),
 * then records an express attendance check-in and lands on the Worker Dashboard —
 * no induction wizard, no knowledge check.
 */
export function ExpressCheckInButton({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<'idle' | 'location'>('idle');
  const [busy, setBusy] = useState(false);

  async function checkIn(location: ConfirmLocation) {
    setBusy(true);
    try {
      const res = await fetch('/api/worker/express-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, location }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        /*
         * A CARD REFUSAL IS A JOURNEY, NOT A MESSAGE.
         *
         * The server hands back where to go when there is somewhere to go, and for a
         * card problem there always is: the details screen is where the number,
         * surname and scheme are corrected and the check re-run. Showing the reason
         * and then leaving somebody at a site gate with nothing to press is the
         * behaviour this replaces.
         */
        if (data.fix?.href) {
          toast.error(data.error ?? 'You cannot check in yet.');
          router.push(data.fix.href);
          return;
        }
        toast.error(
          data.error ?? 'We couldn’t check you in. Please try again.',
        );
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

  if (phase === 'location') {
    return (
      <LocationCheck
        siteId={siteId}
        siteName={siteName}
        busy={busy}
        onConfirmed={checkIn}
      />
    );
  }

  return (
    <Button size="lg" fullWidth onClick={() => setPhase('location')}>
      Check in to site
    </Button>
  );
}
