import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { formatDateTimeUK } from '@/lib/datetime';
import type { PanelVisibility } from '@/services/workerDashboard/dashboardPanels';
import { WorkerNav } from './WorkerNav';
import { SiteSwitcher, type SwitcherSite } from './SiteSwitcher';

/**
 * Worker Dashboard shell (SC-003 / SC-004).
 *
 * Mirrors the Platform shell's structure — brand stripe, header, left sidebar,
 * content column — but wears the worker identity: a green "Worker" badge, the
 * site the worker is checked into and the time they checked in, so the context
 * they are looking at is unambiguous on every screen.
 *
 * When the worker is checked into more than one site at once, a site switcher
 * replaces the static site name so they can move between their sites (SC-004).
 */
export function WorkerShell({
  children,
  siteName,
  checkedInAt,
  panels,
  unreadBulletins = 0,
  sites = [],
  activeSiteId,
}: {
  children: ReactNode;
  siteName: string;
  checkedInAt: Date;
  panels: PanelVisibility;
  unreadBulletins?: number;
  /** Sites the worker is currently checked into (for the switcher). */
  sites?: SwitcherSite[];
  activeSiteId?: string;
}) {
  const multiSite = sites.length > 1 && activeSiteId;
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="h-1 w-full bg-brand-500" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="SiteComply home" className="inline-flex">
              <Logo />
            </Link>
            <span className="rounded-md bg-safe-500 px-2 py-0.5 text-xs font-semibold text-white">
              Worker
            </span>
          </div>
          <div className="flex items-center gap-3">
            {multiSite ? (
              <span className="text-right">
                <SiteSwitcher sites={sites} activeSiteId={activeSiteId} />
                <span className="mt-0.5 block text-xs text-ink-subtle">
                  Checked in: {formatDateTimeUK(checkedInAt)}
                </span>
              </span>
            ) : (
              <span className="text-right">
                <span className="block text-sm font-semibold text-ink">
                  {siteName}
                </span>
                <span className="block text-xs text-ink-subtle">
                  Checked in: {formatDateTimeUK(checkedInAt)}
                </span>
              </span>
            )}
            <a
              href="/api/worker/logout"
              className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
            >
              Sign out
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="shrink-0 md:w-52">
          <div className="space-y-4 md:sticky md:top-6">
            <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
              <WorkerNav panels={panels} unreadBulletins={unreadBulletins} />
            </div>
            <div className="hidden rounded-xl border border-line bg-surface p-4 shadow-card md:block">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
                >
                  ?
                </span>
                Need help?
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                Contact site management, or use the emergency information if
                required.
              </p>
              {panels.SITE_CONTACTS && (
                <Link
                  href="/worker/contacts"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-lg border-2 border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  View contacts
                </Link>
              )}
            </div>
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
