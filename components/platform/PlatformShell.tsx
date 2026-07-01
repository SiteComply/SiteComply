import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { PlatformNav } from './PlatformNav';

/**
 * Platform dashboard shell.
 *
 * Deliberately distinct from the Admin shell (which uses a top nav bar): the
 * Platform area has a left-hand sidebar navigation and a solid-blue "Platform"
 * identity, while reusing SiteComply's header, brand stripe, spacing and cards.
 * UI only — no auth or data behind it yet.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
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
          <Link
            href="/"
            className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Exit preview
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="shrink-0 md:w-52">
          <div className="rounded-xl border border-line bg-surface p-2 shadow-card md:sticky md:top-6">
            <PlatformNav />
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
