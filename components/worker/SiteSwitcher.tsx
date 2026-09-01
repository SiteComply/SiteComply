'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { SiteControlChrome } from './SiteControlChrome';

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
  const selectId = useId();

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

  const active = sites.find((s) => s.siteId === activeSiteId);

  return (
    /*
     * ONE CONTROL, NOT THREE FRAGMENTS.
     *
     * This shipped as a bare <select> with the icon outside its border and the
     * check-in time on a separate right-aligned line beneath it — a left-aligned
     * name in a box, a floating icon and a right-aligned caption, which read as
     * a heading with decoration rather than something you can tap.
     *
     * The chrome below is the visible control; the real <select> sits on top of
     * it, transparent and filling it. That keeps the NATIVE picker — the iOS
     * wheel, the Android sheet, keyboard and screen-reader behaviour — which a
     * custom dropdown would have had to reimplement badly. The visible layer
     * carries the focus ring via `peer-focus-visible`, so keyboard users still
     * see what they are on.
     */
    <div className="relative min-w-0">
      <label htmlFor={selectId} className="sr-only">
        Active site — switch between the sites you are checked into
      </label>
      <select
        id={selectId}
        aria-label="Switch site"
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
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

      <SiteControlChrome
        siteName={active?.siteName ?? 'Select a site'}
        supportingText={busy ? 'Switching…' : 'Switch site'}
        interactive
        dimmed={busy}
      />
    </div>
  );
}
