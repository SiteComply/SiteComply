import { ReactNode } from 'react';
import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';

/**
 * Shared, brand-consistent full-page frame for error experiences (404 + unexpected
 * failures). Deliberately self-contained: it takes no server session and pulls in
 * no data services, so it renders safely from a client error boundary — including
 * `global-error`, where the root layout itself has failed. It reuses SiteComply's
 * header, brand stripe, card styling, spacing and neutrals so a 404 or crash looks
 * like the same product as the Platform and Admin Centre, not a raw stack trace.
 *
 * No technical or sensitive detail is ever rendered here — callers pass only
 * human-readable copy. An optional, non-sensitive `reference` (Next.js error
 * digest) can be shown so a user can quote it to support; the underlying error is
 * logged by the boundary, never displayed.
 */
export function BrandedErrorScreen({
  tone = 'brand',
  eyebrow,
  title,
  description,
  icon,
  reference,
  children,
}: {
  /** Icon accent — brand blue for "not found", danger red for a failure. */
  tone?: 'brand' | 'danger';
  eyebrow: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
  /** Non-sensitive reference code (error digest) shown to help support triage. */
  reference?: string;
  /** Action controls (buttons / links back to a safe location). */
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="border-b border-line bg-surface">
        {/* Thin brand stripe in the logo's light blue — matches every SiteComply shell. */}
        <div className="h-1 w-full bg-brand-500" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-3">
          <Link href="/" aria-label="SiteComply home" className="inline-flex">
            <LogoMark size={32} />
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md animate-fade-in rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <div
            className={
              'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ' +
              (tone === 'danger'
                ? 'bg-danger-50 text-danger-600'
                : 'bg-brand-50 text-brand-600')
            }
          >
            {icon}
          </div>

          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink [text-wrap:balance]">
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-ink-muted">{description}</p>

          <div className="mt-7 grid gap-3">{children}</div>

          {reference && (
            <p className="mt-6 border-t border-line pt-4 text-xs text-ink-subtle">
              Reference code:{' '}
              <span className="font-mono font-semibold text-ink-muted">
                {reference}
              </span>
            </p>
          )}
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-ink-subtle">
          SiteComply — digital site inductions &amp; compliance for UK
          construction.
        </div>
      </footer>
    </div>
  );
}

/** Magnifier — "we looked, it isn't here" (404). */
export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Alert triangle — an unexpected failure. */
export function AlertTriangleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
