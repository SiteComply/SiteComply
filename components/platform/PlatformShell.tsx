import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import { isReadOnlyRole } from '@/services/platformUsers/platformPermissions';
import {
  getPlatformViewer,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { countUnreadPlatformNotifications } from '@/services/notifications/platformNotifications';
import { NotificationPoller } from '@/components/platform/NotificationPoller';
import { PlatformNav } from './PlatformNav';
import { viewerCan } from '@/services/platformUsers/platformAccess';
import { PLATFORM_MODULES } from '@/services/platformUsers/platformPermissions';

/**
 * Platform dashboard shell.
 *
 * Deliberately distinct from the Admin shell (which uses a top nav bar): the
 * Platform area has a left-hand sidebar navigation and a solid-blue "Platform"
 * identity, while reusing SiteComply's header, brand stripe, spacing and cards.
 * Shows the signed-in user, their site-access scope and a sign-out link.
 *
 * UX REFRESH PHASE 1 — the application frame. Two things changed here, both
 * presentation:
 *
 * 1. THE SIDEBAR IS NOW CHROME, NOT CONTENT. It used to render as a floating
 *    card (`rounded-xl border bg-surface shadow-card`) sitting inside the page,
 *    in the same visual language as the panels beside it — so navigation
 *    competed with content instead of framing it. It is now a flush, full-height
 *    rail carrying the product identity at the top and the signed-in user at the
 *    bottom, which is what makes the portal read as one application.
 *
 * 2. THE WIDTH CAP MOVED OFF THE WHOLE PORTAL. Everything was previously capped
 *    at `max-w-6xl` (1152px) INCLUDING the sidebar, leaving roughly 900px of
 *    content on any monitor and ~750px of dead space either side at 1920. The
 *    rail now sits outside the measure and only the content area is capped, at a
 *    width that still reads comfortably. This is the direct fix for the brief's
 *    "many screens waste space" and most of its "too much scrolling" — a layout
 *    with nowhere to go sideways can only grow downwards.
 *
 * Unchanged on purpose: every colour token, the brand stripe, the logo, the
 * "Platform" chip, the skip link, the notification poller, and the fact that
 * which nav items appear is decided by effective permissions.
 */
export async function PlatformShell({ children }: { children: ReactNode }) {
  const viewer = await getPlatformViewer();

  // Notification badge — unread count across all sources (document expiry +
  // action alerts). The derivation applies each source's RBAC + site-scoping.
  const notificationCount = viewer
    ? await countUnreadPlatformNotifications(viewer)
    : 0;

  // SC-022 — modules the viewer can view on AT LEAST ONE assigned site. The nav
  // is global while permissions are per-site, so a single answer has to cover
  // several sites; the page gate and the queries beneath it still enforce
  // per-site truth, so a visible section can never leak data from a site they
  // have lost.
  const allowedModules = viewer
    ? PLATFORM_MODULES.filter((m) => viewerCan(viewer, m, 'view'))
    : undefined;

  const identity = viewer ? (
    <div className="min-w-0">
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="truncate">{viewer.name}</span>
        {isReadOnlyRole(viewer.role) && (
          <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Read-only
          </span>
        )}
      </span>
      {/* The rail is narrower than the old full-width header, so a long scope
          ("Organisation-wide · all 12 sites") can truncate. `title` keeps the
          full value reachable rather than lost. */}
      <span
        className="mt-0.5 block truncate text-xs text-ink-subtle"
        title={`${ROLE_LABELS[viewer.role]} · ${describeScope(viewer)}`}
      >
        {ROLE_LABELS[viewer.role]} · {describeScope(viewer)}
      </span>
    </div>
  ) : null;

  const signOut = (
    <a
      href="/api/platform/auth/logout"
      className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
    >
      Sign out
    </a>
  );

  return (
    <div className="min-h-dvh bg-surface-sunken">
      {/* SC-016: keeps the badge live without a manual refresh. */}
      {viewer && <NotificationPoller initialCount={notificationCount} />}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <div className="flex min-h-dvh flex-col md:flex-row">
        {/* The rail. Flush to the viewport edge, full height, its own surface —
            chrome that frames the work rather than a card that competes with it.
            Below `md` it collapses to the stacked header + horizontal nav
            scroller it has always used on phones. */}
        {/* UX REFRESH PHASE 7 — `print:hidden` fixes a defect the print check
            caught on the CPP: the whole navigation rail was printing down the
            left of the page, squeezing a legal handover document into the
            remaining two thirds. PRE-EXISTING, not introduced by the refresh —
            the shell has never carried print rules, so the old header and
            sidebar printed too. Application chrome has no business on a
            document a duty-holder signs. */}
        <aside className="shrink-0 border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:border-b-0 md:border-r print:hidden">
          <div className="h-1 w-full bg-brand-500" aria-hidden="true" />
          <div className="flex h-[calc(100%-0.25rem)] flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3 md:justify-start">
              <div className="flex items-center gap-2">
                <Link
                  href="/"
                  aria-label="SiteComply home"
                  className="inline-flex"
                >
                  <Logo />
                </Link>
                <span className="rounded-md bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">
                  Platform
                </span>
              </div>
              {/* On phones the sign-out has nowhere else to go, so it stays in
                  the top row beside the logo. */}
              <div className="md:hidden">{signOut}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:pb-0">
              <PlatformNav
                role={viewer?.role}
                allowedModules={allowedModules}
                notificationCount={notificationCount}
              />
            </div>

            {/* Identity sits at the foot of the rail on desktop — present, but
                out of the way of the work. */}
            {viewer && (
              <div className="hidden border-t border-line px-4 py-3 md:block">
                {identity}
                <div className="mt-2">{signOut}</div>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The signed-in identity on phones, where the rail's footer is
              hidden. Desktop gets it in the rail instead. */}
          {viewer && (
            <div className="border-b border-line bg-surface px-4 py-2 md:hidden print:hidden">
              {identity}
            </div>
          )}
          <main
            id="main"
            className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 py-6 md:px-8 print:max-w-none print:p-0"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
