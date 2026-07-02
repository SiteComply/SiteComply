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
  { href: '/admin/platform-users', label: 'Platform Users' },
  { href: '/admin/platform-access-requests', label: 'Platform Access Requests' },
] as const;

export function AdminNav({
  pendingAccessRequests = 0,
}: {
  pendingAccessRequests?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Admin sections">
      {ADMIN_NAV.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);
        const showBadge =
          item.href === '/admin/platform-access-requests' &&
          pendingAccessRequests > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
            )}
          >
            {item.label}
            {showBadge && (
              <span
                className="ml-2 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-danger-500 px-1.5 text-xs font-bold leading-none text-white"
                aria-label={`${pendingAccessRequests} pending ${
                  pendingAccessRequests === 1 ? 'request' : 'requests'
                } — action required`}
              >
                {pendingAccessRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
