import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import { isReadOnlyRole } from '@/services/platformUsers/platformPermissions';
import {
  getPlatformViewer,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { PlatformNav } from './PlatformNav';

/**
 * Platform dashboard shell.
 *
 * Deliberately distinct from the Admin shell (which uses a top nav bar): the
 * Platform area has a left-hand sidebar navigation and a solid-blue "Platform"
 * identity, while reusing SiteComply's header, brand stripe, spacing and cards.
 * Shows the signed-in user, their site-access scope and a sign-out link.
 */
export async function PlatformShell({ children }: { children: ReactNode }) {
  const viewer = await getPlatformViewer();

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
            <span className="rounded-md bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">
              Platform
            </span>
          </div>
          <div className="flex items-center gap-3">
            {viewer && (
              <span className="hidden text-right sm:block">
                <span className="flex items-center justify-end gap-2 text-sm font-semibold text-ink">
                  {viewer.name}
                  {isReadOnlyRole(viewer.role) && (
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Read-only
                    </span>
                  )}
                </span>
                <span className="block text-xs text-ink-subtle">
                  {ROLE_LABELS[viewer.role]} · {describeScope(viewer)}
                </span>
              </span>
            )}
            <a
              href="/api/platform/auth/logout"
              className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
            >
              Sign out
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="shrink-0 md:w-52">
          <div className="rounded-xl border border-line bg-surface p-2 shadow-card md:sticky md:top-6">
            <PlatformNav role={viewer?.role} />
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
