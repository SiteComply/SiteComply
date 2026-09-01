'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { WorkerIcon } from './icons';
import { cn } from '@/lib/cn';

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

      <span
        aria-hidden="true"
        className={cn(
          'touch-target flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-left transition-colors',
          'peer-hover:border-brand-200 peer-hover:bg-brand-50',
          'peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
          busy && 'opacity-60',
        )}
      >
        <WorkerIcon name="building" className="h-5 w-5 shrink-0 text-ink-subtle" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {active?.siteName ?? 'Select a site'}
          </span>
          {/* The affordance, in words. An icon alone was not enough: workers
              read this as a title of the page they were already on.

              "Switch site" rather than "Tap to switch site" because at 320px
              the longer string truncated to "Tap to switch…" — the one line
              here whose whole job is to survive being squeezed. */}
          <span className="block truncate text-xs text-ink-subtle">
            {busy ? 'Switching…' : 'Switch site'}
          </span>
        </span>
        <WorkerIcon name="chevronDown" className="h-4 w-4 shrink-0 text-ink-subtle" />
      </span>
    </div>
  );
}
