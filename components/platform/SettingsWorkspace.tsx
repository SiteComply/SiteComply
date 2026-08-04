import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/platform/PageHeader';

/**
 * Settings as ONE workspace rather than a chooser and two destinations.
 *
 * The landing page used to contain nothing but two feature cards linking
 * elsewhere — a menu, not a screen. Configuration templates and Permission
 * templates are the same kind of work (define an organisation standard, plus the
 * company-wide policy that overrides it), so presenting them as two independent
 * boxes was what made them feel unrelated. They are now areas inside one place,
 * with a navigator that keeps both in view from either of them.
 *
 * EXISTING URLS ARE PRESERVED. Each area keeps its own route, so links from
 * elsewhere in the product — and the two historical redirects SC-021 Phase 2 set
 * up in next.config.js — continue to resolve. `active` is passed by the page
 * rather than read from the pathname, so this stays a server component.
 *
 * Presentation only: which areas appear is decided by the caller, and every page
 * behind them keeps the gates it already had.
 */
export interface SettingsArea {
  key: string;
  label: string;
  href: string;
  description: string;
}

export const SETTINGS_AREAS: SettingsArea[] = [
  {
    key: 'config-templates',
    label: 'Configuration templates',
    href: '/platform/dashboard/settings/config-templates',
    description:
      'Reusable sets of permits and inspections, and the services every site must have.',
  },
  {
    key: 'permission-templates',
    label: 'Permission templates',
    href: '/platform/dashboard/settings/permission-templates',
    description:
      'Reusable access restrictions for contractor types, and company-wide defaults.',
  },
];

export function SettingsWorkspace({
  active,
  areas = SETTINGS_AREAS,
  children,
}: {
  active: string;
  areas?: SettingsArea[];
  children: ReactNode;
}) {
  const current = areas.find((a) => a.key === active) ?? areas[0];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation-wide configuration that applies across every site."
      />

      <div className="grid gap-4 lg:grid-cols-[13.5rem_1fr]">
        <nav
          aria-label="Settings areas"
          className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:self-start lg:overflow-visible"
        >
          {areas.map((a) => {
            const isActive = a.key === current?.key;
            return (
              <Link
                key={a.key}
                href={a.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'touch-target flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:whitespace-normal',
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {a.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          {current && (
            <div className="mb-3">
              <h2 className="text-base font-bold text-ink">{current.label}</h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {current.description}
              </p>
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}
