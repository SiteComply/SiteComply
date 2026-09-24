'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CARD_FIX_HREF } from '@/services/cscs/cardFixFlow';

/**
 * Asks an operative to put their card details right, once, and lets them get on.
 *
 * DISMISSIBLE BY DESIGN for this rollout. A hard redirect would stop someone
 * reaching their permits and RAMS over a card problem they may not be able to
 * fix standing on a site, and the point of this step is to collect the missing
 * details without anybody losing a morning.
 *
 * Dismissal is remembered per STATUS, not per worker: dismissing "expired" must
 * not silence a later "withdrawn", which is the more serious message.
 *
 * Rendered from the server having already decided this operative needs it, so
 * the component makes no judgement of its own beyond remembering the dismissal.
 */
export function CscsRemediationBanner({
  heading,
  action,
  dismissKey,
}: {
  heading: string;
  action: string;
  dismissKey: string;
}) {
  // Start hidden: a banner that flashes on every page load before localStorage
  // is read is worse than one that appears a moment late.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(dismissKey) !== '1');
    } catch {
      // Private browsing, storage disabled - show it. Erring towards the
      // operative seeing the message is the right way round.
      setShow(true);
    }
  }, [dismissKey]);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      /* Not remembering a dismissal is a small annoyance; failing is not. */
    }
    setShow(false);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-xl bg-hivis-400/20 px-4 py-3 ring-1 ring-inset ring-hivis-500"
    >
      <p className="text-sm font-semibold text-ink">{heading}</p>
      <p className="mt-1 text-sm text-ink-muted">{action}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={CARD_FIX_HREF}
          className="touch-target rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Check my card details
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="touch-target text-sm font-semibold text-ink-muted underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
