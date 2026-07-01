'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  permits,
  type PlatformModule,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import { PlatformIcon, type PlatformIconName } from './icons';

/**
 * Left-hand navigation for the Platform dashboard. Vertical on desktop; collapses
 * to a horizontal scroller on small screens. Items are shown only if the viewer
 * may view that module (enforced for Director/Project Manager/Client).
 */
export const PLATFORM_NAV: {
  href: string;
  label: string;
  icon: PlatformIconName;
  module: PlatformModule;
}[] = [
  { href: '/platform/dashboard', label: 'Dashboard', icon: 'grid', module: 'dashboard' },
  { href: '/platform/dashboard/sites', label: 'Sites', icon: 'pin', module: 'sites' },
  { href: '/platform/dashboard/submissions', label: 'Submissions', icon: 'clipboard', module: 'checkins' },
  { href: '/platform/dashboard/reports', label: 'Reports', icon: 'chart', module: 'reports' },
  { href: '/platform/dashboard/documents', label: 'Documents', icon: 'doc', module: 'documents' },
  { href: '/platform/dashboard/audits', label: 'Audits', icon: 'shield', module: 'audits' },
  { href: '/platform/dashboard/actions', label: 'Actions', icon: 'bolt', module: 'actions' },
];

export function PlatformNav({ role }: { role?: PlatformRoleValue }) {
  const pathname = usePathname();
  const items = role
    ? PLATFORM_NAV.filter((item) => permits(role, item.module, 'view'))
    : PLATFORM_NAV;

  return (
    <nav
      aria-label="Platform sections"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {items.map((item) => {
        const active =
          item.href === '/platform/dashboard'
            ? pathname === '/platform/dashboard'
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-500 text-white shadow-sm shadow-brand-600/20'
                : 'text-ink-muted hover:bg-brand-50 hover:text-brand-700',
            )}
          >
            <PlatformIcon name={item.icon} className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
