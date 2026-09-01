import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { formatDateTimeUK } from '@/lib/datetime';
import type { PanelVisibility } from '@/services/workerDashboard/dashboardPanels';
import { WorkerNav } from './WorkerNav';
import { SiteSwitcher, type SwitcherSite } from './SiteSwitcher';
import { CheckOutOfSiteButton } from './CheckOutOfSiteButton';

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
  submissionId,
}: {
  children: ReactNode;
  siteName: string;
  checkedInAt: Date;
  panels: PanelVisibility;
  unreadBulletins?: number;
  /** Sites the worker is currently checked into (for the switcher). */
  sites?: SwitcherSite[];
  activeSiteId?: string;
  /**
   * The open check-in being viewed. Supplied by every worker page from
   * requireWorkerContext(), so the header check-out is available wherever a
   * worker finishes their session — not only on the Dashboard, which was the
   * single page that carried the action.
   */
  submissionId?: string;
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
        {/* Wraps to a second row below `sm` rather than overflowing. Adding the
            header check-out put three items beside the brand, and on a 320px
            phone the row ran off the screen: the logo was squeezed to nothing
            and Sign out was clipped by the viewport edge. Everything keeps its
            place on a normal screen; only the narrowest phones get the second
            row, which is where a worker actually uses this. */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          {/* Sign out sits with the identity, not with the site controls.
              Below sm the actions row is full-width and held three items —
              switcher, Check out, Sign out — needing about 407px in the 358px a
              390px phone has. Sign out is the one with no relationship to the
              site, so moving it here leaves two items to share that row and the
              overflow has nowhere to come from. */}
          <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
            <span className="flex items-center gap-2">
              <Link
                href="/"
                aria-label="SiteComply home"
                className="inline-flex shrink-0"
              >
                <Logo />
              </Link>
              <span className="shrink-0 rounded-md bg-safe-500 px-2 py-0.5 text-xs font-semibold text-white">
                Worker
              </span>
            </span>
            <a
              href="/api/worker/logout"
              className="touch-target inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken sm:hidden"
            >
              Sign out
            </a>
          </div>
          <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto sm:gap-3">
            {multiSite ? (
              // `flex-1 min-w-0` is the fix for the overlap: the switcher was
              // a fixed 192px that could not shrink, so at every phone width
              // Check out was laid out on top of it — 117px of overlap at
              // 320px, and every tap in that band, including over the select's
              // own chevron, went to Check out. Flexible, it gives way and
              // truncates instead, which is the rule the single-site branch
              // below has always followed.
              <span className="min-w-0 flex-1 text-left">
                <SiteSwitcher sites={sites} activeSiteId={activeSiteId} />
                {/* Left-aligned to sit under the control rather than opposite
                    it. Right-aligned, it read as a caption belonging to the row
                    instead of a line belonging to the site above it — part of
                    why the group looked like a heading with decoration. It
                    stays OUTSIDE the control deliberately: folding it into the
                    control's second line, as first drawn, would put it in
                    competition with "Tap to switch site" and at 320px the
                    affordance is what would truncate away. */}
                <span className="mt-0.5 block truncate pl-1 text-xs text-ink-subtle">
                  Checked in: {formatDateTimeUK(checkedInAt)}
                </span>
              </span>
            ) : (
              // The site context is the only flexible item in the row, so it is
              // the one that gives way: it truncates instead of pushing the
              // actions off screen.
              <span className="min-w-0 text-right">
                <span className="block truncate text-sm font-semibold text-ink">
                  {siteName}
                </span>
                <span className="block truncate text-xs text-ink-subtle">
                  Checked in: {formatDateTimeUK(checkedInAt)}
                </span>
              </span>
            )}
            {/* Between the site context and Sign out: it acts on the site named
                to its left. CHECK_OUT is a locked-on panel, but it is honoured
                here exactly as the Dashboard honours it, so the header can never
                outlive the setting. The Dashboard keeps its large primary
                button; this is the secondary route for finishing elsewhere. */}
            {submissionId && panels.CHECK_OUT && (
              <CheckOutOfSiteButton
                submissionId={submissionId}
                variant="header"
              />
            )}
            {/* Shown from sm up, where the single-row header has room for it.
                Below sm the copy in the identity row above takes over. */}
            <a
              href="/api/worker/logout"
              className="touch-target hidden shrink-0 items-center whitespace-nowrap rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken sm:inline-flex"
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
