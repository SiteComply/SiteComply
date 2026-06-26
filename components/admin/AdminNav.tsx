'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Primary admin navigation. The destinations beyond the dashboard are built in
 * Stages 8–11; the links are in place so the shell is complete now.
 */
export const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/sites', label: 'Job sites' },
  { href: '/admin/on-site', label: 'On site now' },
  { href: '/admin/submissions', label: 'Submissions' },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Admin sections">
      {ADMIN_NAV.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
