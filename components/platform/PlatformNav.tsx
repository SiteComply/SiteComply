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
  /**
   * Optional extra restriction ON TOP of the module gate — NOT a permission.
   * The pages behind these entries keep their own gates unchanged; this only
   * decides whose navigation shows the entry, so an organisation-wide
   * configuration area isn't advertised to roles who cannot act on it.
   */
  roles?: PlatformRoleValue[];
}[] = [
  {
    href: '/platform/dashboard',
    label: 'Dashboard',
    icon: 'grid',
    module: 'dashboard',
  },
  {
    href: '/platform/dashboard/notifications',
    label: 'Notifications',
    icon: 'bell',
    module: 'dashboard',
  },
  {
    href: '/platform/dashboard/sites',
    label: 'Sites',
    icon: 'pin',
    module: 'sites',
  },
  {
    href: '/platform/dashboard/submissions',
    label: 'Check-ins',
    icon: 'clipboard',
    module: 'checkins',
  },
  {
    href: '/platform/dashboard/reports',
    label: 'Reports',
    icon: 'chart',
    module: 'reports',
  },
  {
    href: '/platform/dashboard/documents',
    label: 'Documents',
    icon: 'doc',
    module: 'documents',
  },
  {
    href: '/platform/dashboard/compliance-calendar',
    label: 'Compliance',
    icon: 'clipboard',
    // SC-020: scheduling recurring audits, so it sits under the audits module —
    // no RBAC matrix change was needed.
    module: 'audits',
  },
  {
    href: '/platform/dashboard/audits',
    label: 'Audits',
    icon: 'shield',
    module: 'audits',
  },
  {
    href: '/platform/dashboard/actions',
    label: 'Actions',
    icon: 'bolt',
    module: 'actions',
  },
  {
    href: '/platform/dashboard/permits',
    label: 'Permits',
    icon: 'permit',
    module: 'permits',
  },
  {
    // SC-021 — organisation-wide configuration. Deliberately LAST: it is
    // administration, not daily work, and should not sit among the operational
    // screens people open every morning.
    //
    // Uses the existing `sites` module so PLATFORM_PERMISSIONS is untouched;
    // the Director/Project Manager restriction is navigation visibility only
    // and matches who can actually manage a shared template.
    href: '/platform/dashboard/settings',
    label: 'Settings',
    icon: 'sliders',
    module: 'sites',
    roles: ['DIRECTOR', 'PROJECT_MANAGER'],
  },
];

const NOTIFICATIONS_HREF = '/platform/dashboard/notifications';

export function PlatformNav({
  role,
  notificationCount = 0,
  allowedModules,
}: {
  role?: PlatformRoleValue;
  notificationCount?: number;
  /**
   * SC-022 — modules the viewer may view somewhere, resolved server-side from
   * effective (role ∩ per-site override) permissions. When absent the role
   * baseline is used, so nothing changes for a viewer with no overrides.
   */
  allowedModules?: PlatformModule[];
}) {
  const pathname = usePathname();
  const items = role
    ? PLATFORM_NAV.filter(
        (item) =>
          (allowedModules
            ? allowedModules.includes(item.module)
            : permits(role, item.module, 'view')) &&
          (!item.roles || item.roles.includes(role)),
      )
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
            <span className="flex-1">{item.label}</span>
            {item.href === NOTIFICATIONS_HREF && notificationCount > 0 && (
              <span
                aria-label={`${notificationCount} notifications`}
                className={cn(
                  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold',
                  active
                    ? 'bg-white text-brand-700'
                    : 'bg-danger-500 text-white',
                )}
              >
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
