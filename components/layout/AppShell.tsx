import { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/cn';

/**
 * Responsive application shell.
 *
 * Mobile-first: a compact sticky top bar with the SiteComply brand, a single
 * centred content column constrained for one-handed phone use, and an optional
 * footer slot. Admin screens reuse the same shell with a wider container.
 */
export function AppShell({
  children,
  width = 'narrow',
  topBarRight,
  footer,
}: {
  children: ReactNode;
  width?: 'narrow' | 'wide';
  topBarRight?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        {/* Hi-vis brand stripe — a thin nod to construction site signage. */}
        <div className="h-1 w-full bg-hivis-500" aria-hidden="true" />
        <div
          className={cn(
            'mx-auto flex w-full items-center justify-between gap-3 px-4 py-3',
            width === 'narrow' ? 'max-w-xl' : 'max-w-6xl',
          )}
        >
          <Logo />
          {topBarRight}
        </div>
      </header>

      <main
        id="main"
        className={cn(
          'mx-auto flex w-full flex-1 flex-col px-4 py-6',
          width === 'narrow' ? 'max-w-xl' : 'max-w-6xl',
        )}
      >
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div
          className={cn(
            'mx-auto w-full px-4 py-4 text-xs text-ink-subtle',
            width === 'narrow' ? 'max-w-xl' : 'max-w-6xl',
          )}
        >
          {footer ?? (
            <p>
              SiteComply — digital site inductions &amp; compliance for UK
              construction. Your personal data is handled in line with UK GDPR.{' '}
              <a href="/privacy" className="font-semibold text-brand-700">
                Privacy notice
              </a>
              .
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
