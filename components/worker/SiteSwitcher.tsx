'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { WorkerIcon } from './icons';

export interface SwitcherSite {
  siteId: string;
  siteName: string;
}

/**
 * Site switcher (SC-004). Shown in the Worker Dashboard header only when the
 * worker is checked into more than one site at once. Choosing a site records it
 * as the active site (server re-validates it against the worker's open check-ins)
 * and refreshes so every panel re-renders for the newly selected site.
 */
export function SiteSwitcher({
  sites,
  activeSiteId,
}: {
  sites: SwitcherSite[];
  activeSiteId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function switchTo(siteId: string) {
    if (siteId === activeSiteId || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/worker/active-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not switch site.');
        return;
      }
      // Land on the dashboard of the newly active site and re-render panels.
      router.push('/worker/dashboard');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="text-ink-subtle" aria-hidden="true">
        <WorkerIcon name="building" className="h-4 w-4" />
      </span>
      <span className="sr-only">Active site</span>
      {/* `w-full min-w-0` rather than a fixed max-width: a <select> will not
          shrink below its widest option unless told to, which is what made this
          a rigid 192px at every width and let the header's Check out button be
          laid out on top of it. `touch-target` takes it from 35px to the 52px
          the controls beside it already use. */}
      <select
        aria-label="Switch site"
        className="touch-target w-full min-w-0 truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
        value={activeSiteId}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value)}
      >
        {sites.map((s) => (
          <option key={s.siteId} value={s.siteId}>
            {s.siteName}
          </option>
        ))}
      </select>
    </label>
  );
}
