'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Tab navigation for the Site Details area. Each tab is its own route so tabs are
 * deep-linkable and each loads only its own data. The Overview tab keeps the
 * original Site Details URL. Which tabs appear is decided server-side (by role)
 * and passed in via `tabs`.
 */
export type SiteTabKey =
  | 'overview'
  | 'workers'
  | 'experience'
  | 'compliance'
  | 'documents'
  | 'access';

export interface SiteTab {
  key: SiteTabKey;
  label: string;
}

const SEGMENT: Record<SiteTabKey, string> = {
  overview: '',
  workers: '/workers',
  experience: '/experience',
  compliance: '/compliance',
  documents: '/documents',
  // SC-022 — per-project contractor access.
  access: '/access',
};

export function SiteDetailTabs({
  siteId,
  tabs,
  active,
}: {
  siteId: string;
  tabs: SiteTab[];
  active: SiteTabKey;
}) {
  const pathname = usePathname();
  const base = `/platform/dashboard/sites/${siteId}`;

  return (
    <nav
      aria-label="Site sections"
      className="mt-4 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => {
        const href = `${base}${SEGMENT[tab.key]}`;
        // Prefer the passed `active` (server-known); fall back to the pathname.
        const isActive = active ? active === tab.key : pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
              isActive
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-ink-muted hover:border-line hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
