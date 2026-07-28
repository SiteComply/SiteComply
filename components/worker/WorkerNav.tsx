'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type {
  PanelVisibility,
  WorkerDashboardPanelValue,
} from '@/services/workerDashboard/dashboardPanels';
import { WorkerIcon, type WorkerIconName } from './icons';

/**
 * Worker Dashboard navigation (SC-003). Vertical sidebar on desktop, collapsing
 * to a horizontal scroller on phones — the primary worker device.
 *
 * Every destination except the dashboard itself is tied to a configurable panel,
 * so a site that has switched a panel off never shows a link to it. `Check out`
 * is a panel too, but it is locked on, so it is always present.
 */
const WORKER_NAV: {
  href: string;
  label: string;
  icon: WorkerIconName;
  /** Panels that keep this item visible — shown if ANY of them is enabled. */
  panels: WorkerDashboardPanelValue[];
}[] = [
  { href: '/worker/dashboard', label: 'Dashboard', icon: 'grid', panels: [] },
  {
    // Always visible (panels: []) — a worker's own attendance record is never
    // hidden by a site's panel config (SC-010).
    href: '/worker/attendance',
    label: 'Attendance',
    icon: 'clock',
    panels: [],
  },
  {
    href: '/worker/site-information',
    label: 'Site information',
    icon: 'building',
    panels: ['SITE_INFORMATION'],
  },
  {
    href: '/worker/bulletins',
    label: 'Bulletins',
    icon: 'megaphone',
    panels: ['DAILY_BULLETIN'],
  },
  {
    href: '/worker/permits',
    label: 'Permits',
    icon: 'permit',
    panels: ['ACTIVE_PERMITS'],
  },
  { href: '/worker/rams', label: 'RAMS', icon: 'rams', panels: ['RAMS'] },
  {
    href: '/worker/documents',
    label: 'Documents',
    icon: 'doc',
    panels: ['SITE_DOCUMENTS'],
  },
  {
    href: '/worker/messages',
    label: 'Messages',
    icon: 'message',
    panels: ['MESSAGES'],
  },
  {
    href: '/worker/emergency',
    label: 'Emergency info',
    icon: 'alert',
    panels: ['EMERGENCY_INFORMATION', 'FIRST_AIDER', 'FIRE_ASSEMBLY_POINT'],
  },
  {
    href: '/worker/contacts',
    label: 'Contacts',
    icon: 'phone',
    panels: ['SITE_CONTACTS'],
  },
  {
    href: '/worker/actions',
    label: 'Actions',
    icon: 'clipboard',
    panels: ['OUTSTANDING_ACTIONS'],
  },
];

export function WorkerNav({
  panels,
  unreadBulletins = 0,
}: {
  panels: PanelVisibility;
  unreadBulletins?: number;
}) {
  const pathname = usePathname();
  const items = WORKER_NAV.filter(
    (item) => item.panels.length === 0 || item.panels.some((p) => panels[p]),
  );

  return (
    <nav
      aria-label="Worker dashboard sections"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {items.map((item) => {
        const active =
          item.href === '/worker/dashboard'
            ? pathname === '/worker/dashboard'
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
            <WorkerIcon name={item.icon} className="h-5 w-5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.href === '/worker/bulletins' && unreadBulletins > 0 && (
              <span
                aria-label={`${unreadBulletins} unread bulletins`}
                className={cn(
                  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold',
                  active
                    ? 'bg-white text-brand-700'
                    : 'bg-danger-500 text-white',
                )}
              >
                {unreadBulletins > 99 ? '99+' : unreadBulletins}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
