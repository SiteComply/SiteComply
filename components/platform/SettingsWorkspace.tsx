import type { ReactNode } from 'react';
import { PageHeader } from '@/components/platform/PageHeader';
import { SectionWorkspace } from '@/components/platform/SectionWorkspace';

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
 *
 * UX REFRESH PHASE 9 — this navigator was a second, hand-rolled copy of the one
 * in `SectionWorkspace`: same widths, same classes, same active treatment, typed
 * out twice. It now renders THROUGH that component, so Phase 9's dividers and
 * spacing reached Settings for free and the two can no longer drift apart — the
 * same reason `Section` delegates to `Panel` and `AuditScoringConfig`'s own card
 * does too. Areas keep their absolute hrefs (the URLs are load-bearing: SC-021
 * Phase 2's historical redirects still resolve to them), which is why `hrefFor`
 * looks an area up rather than building a `?section=` query.
 */
export interface SettingsArea {
  key: string;
  label: string;
  href: string;
  description: string;
}

export const SETTINGS_AREAS: SettingsArea[] = [
  {
    // CPP Tier 3A — company policy written once and inherited by every site's
    // Construction Phase Plan. Listed first: it is authored content a Director
    // owns, not a per-site switch.
    key: 'arrangements',
    label: 'Management arrangements',
    href: '/platform/dashboard/settings/arrangements',
    description:
      'Health and safety file, management structure, worker consultation, contractor selection, public protection and incident reporting — inherited by every project.',
  },
  {
    /*
     * Company induction content, inherited by every project's induction the way
     * arrangements are inherited by its plan. Listed next to them because it is
     * the same KIND of thing - authored organisational content a Director owns -
     * rather than a per-site switch.
     */
    key: 'induction-modules',
    label: 'Induction modules',
    href: '/platform/dashboard/settings/induction-modules',
    description:
      'PPE expectations, behavioural standards, accident and near-miss reporting, housekeeping, manual handling and environmental awareness — the standard content every induction carries.',
  },
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
  {
    key: 'company',
    label: 'Company profile & branding',
    href: '/platform/dashboard/settings/company',
    description:
      'Company details, logos and the standard wording used on generated documents.',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    href: '/platform/dashboard/settings/notifications',
    description:
      'What SiteComply tells people about, and how far ahead reminders start.',
  },
  {
    key: 'authentication',
    label: 'Authentication & access',
    href: '/platform/dashboard/settings/authentication',
    description:
      'How people sign in, how long sessions last, and who may reach a site.',
  },
  {
    key: 'errors',
    label: 'Error log',
    href: '/platform/dashboard/settings/errors',
    description:
      'Problems the system hit on its own, with the page, person and device.',
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
  const byKey = new Map(areas.map((a) => [a.key, a.href]));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation-wide configuration that applies across every site."
      />

      <SectionWorkspace
        sections={areas.map((a) => ({
          key: a.key,
          label: a.label,
          description: a.description,
        }))}
        active={current?.key ?? ''}
        // Each area owns its route, so the navigator links to it directly rather
        // than to a query on this one.
        hrefFor={(key) => byKey.get(key) ?? areas[0]?.href ?? '#'}
        navLabel="Settings areas"
      >
        {children}
      </SectionWorkspace>
    </>
  );
}
