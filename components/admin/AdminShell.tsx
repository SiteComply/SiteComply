import { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { AdminNav } from '@/components/admin/AdminNav';

/**
 * Admin dashboard shell: brand header with the signed-in admin and sign-out,
 * the primary navigation, and a wide content area. Responsive, but optimised
 * for desktop use where admins do most of their work.
 */
export function AdminShell({
  adminName,
  adminRole,
  children,
}: {
  adminName: string;
  adminRole: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="h-1 w-full bg-hivis-500" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="SiteComply home" className="inline-flex">
              <Logo />
            </Link>
            <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-right sm:block">
              <span className="block text-sm font-semibold text-ink">
                {adminName}
              </span>
              <span className="block text-xs capitalize text-ink-subtle">
                {adminRole.toLowerCase()}
              </span>
            </span>
            {/* Sign-out is a plain navigation to the logout route. */}
            <a
              href="/api/admin/auth/logout"
              className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
            >
              Sign out
            </a>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-2">
          <AdminNav />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
