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
import {
  navGroupRuns,
  NAV_GROUP_LABEL_CLASS,
  NAV_GROUP_SPLIT_MD,
} from './navUi';

/**
 * Left-hand navigation for the Platform dashboard. Vertical on desktop; collapses
 * to a horizontal scroller on small screens. Items are shown only if the viewer
 * may view that module (enforced for Director/Project Manager/Client).
 *
 * UX REFRESH PHASE 1 — the eleven entries are now clustered by the kind of work
 * they represent (overview / operations / records / administration). Eleven flat
 * items give the eye no structure to land on; four short runs do.
 *
 * UX REFRESH PHASE 9 — those clusters are now VISIBLE. Phase 1 expressed them as
 * spacing alone (12px between runs, 4px between items) and left the headings off
 * on purpose. On the built page that difference does not register: the rail reads
 * as one uniform list of eleven, which is what the review reported. Each run now
 * carries a hairline rule, a real gap and a quiet label naming it.
 *
 * The grouping is still cosmetic and nothing else reads it: items are filtered
 * exactly as before, one at a time, by effective module permission and the
 * optional role restriction, and order within the nav is unchanged. A label only
 * ever names entries this viewer can already see — a run whose items were all
 * filtered out renders nothing, heading included, so the rail can never hint at
 * a section someone lacks.
 */

/** Cosmetic clusters, rendered as a labelled run each. NOT a permission. */
type NavGroup = 'overview' | 'projects' | 'insight' | 'compliance' | 'admin';

/**
 * What each cluster is called in the rail. Named for the work, not for the
 * internal group id — "insight" is a code word, "Reports & records" is what a
 * site manager is actually looking for.
 */
const GROUP_LABEL: Record<NavGroup, string> = {
  overview: 'Overview',
  projects: 'Projects',
  insight: 'Reports & records',
  compliance: 'Compliance',
  admin: 'Administration',
};

export const PLATFORM_NAV: {
  href: string;
  label: string;
  icon: PlatformIconName;
  module: PlatformModule;
  group: NavGroup;
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
    group: 'overview',
  },
  {
    href: '/platform/dashboard/notifications',
    label: 'Notifications',
    icon: 'bell',
    module: 'dashboard',
    group: 'overview',
  },
  {
    href: '/platform/dashboard/sites',
    label: 'Sites',
    icon: 'pin',
    module: 'sites',
    group: 'projects',
  },
  {
    href: '/platform/dashboard/submissions',
    label: 'Check-ins',
    icon: 'clipboard',
    module: 'checkins',
    group: 'projects',
  },
  {
    href: '/platform/dashboard/reports',
    label: 'Reports',
    icon: 'chart',
    module: 'reports',
    group: 'insight',
  },
  {
    href: '/platform/dashboard/documents',
    label: 'Documents',
    icon: 'doc',
    module: 'documents',
    group: 'insight',
  },
  {
    href: '/platform/dashboard/compliance-calendar',
    label: 'Compliance',
    icon: 'clipboard',
    // SC-020: scheduling recurring audits, so it sits under the audits module —
    // no RBAC matrix change was needed.
    module: 'audits',
    group: 'compliance',
  },
  {
    href: '/platform/dashboard/audits',
    label: 'Audits',
    icon: 'shield',
    module: 'audits',
    group: 'compliance',
  },
  {
    href: '/platform/dashboard/actions',
    label: 'Actions',
    icon: 'bolt',
    module: 'actions',
    group: 'compliance',
  },
  {
    href: '/platform/dashboard/permits',
    label: 'Permits',
    icon: 'permit',
    module: 'permits',
    group: 'compliance',
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
    group: 'admin',
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

  const runs = navGroupRuns(items, (item) => item.group);

  return (
    <nav
      aria-label="Platform sections"
      className="flex gap-1 overflow-x-auto md:flex-col md:gap-0 md:overflow-visible"
    >
      {runs.map((run, ri) => (
        <div
          key={run.group ?? ri}
          // A named group rather than a bare div: the rule and the label are
          // visual, so the same structure has to be reachable without sight.
          role="group"
          aria-label={
            run.group ? GROUP_LABEL[run.group as NavGroup] : undefined
          }
          className={cn('flex gap-1 md:flex-col', ri > 0 && NAV_GROUP_SPLIT_MD)}
        >
          {run.group && (
            // Hidden below `md`, where the rail is a horizontal scroller and a
            // stack of headings would cost more width than it earns; the rule
            // between runs carries the grouping there. `aria-hidden` because the
            // wrapper above already announces the name.
            <p
              aria-hidden="true"
              className={cn(NAV_GROUP_LABEL_CLASS, 'hidden md:block')}
            >
              {GROUP_LABEL[run.group as NavGroup]}
            </p>
          )}
          {run.items.map((item) => {
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
        </div>
      ))}
    </nav>
  );
}
