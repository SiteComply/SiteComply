import Link from 'next/link';
import {
  SettingsIcon,
  type SettingsIconName,
} from '@/components/admin/SettingsIcons';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings landing. A grouped index, not a dashboard.
 *
 * This was four cards in a responsive grid. Cards gave four administrative
 * areas the visual weight of four features, spread them across three columns at
 * desktop width, and left the page looking lighter and more fragmented than the
 * thing it configures. It is now one vertical list per group: the sections read
 * in a fixed order and the eye runs down a single rail of icons.
 *
 * Every row does exactly one thing — name a place and take you there. There is
 * deliberately NO status column. One shipped briefly, carrying a value summary
 * per row, and in the running app it read as noise rather than information:
 * the strings were static, so they could not be trusted to describe live
 * configuration, and a reader cannot tell a stale summary from a current one.
 * A settings index answers "where do I go", not "how is everything doing" — the
 * state of a thing belongs on the page that owns it. If status earns a place
 * here later it should arrive as a real read, never as a fixed string.
 *
 * Adding an area is a row. Adding a group is a label and a container. Keep
 * descriptions to one line — two is the ceiling; if a section needs three, its
 * name is wrong.
 */
type SettingsArea = {
  href: string;
  icon: SettingsIconName;
  title: string;
  description: string;
};

const SETTINGS_GROUPS: ReadonlyArray<{
  label: string;
  areas: ReadonlyArray<SettingsArea>;
}> = [
  {
    label: 'Platform configuration',
    areas: [
      {
        href: '/admin/settings/integrations',
        icon: 'plug',
        title: 'Integrations',
        description:
          'SMS, AI and CSCS providers, credentials and connection tests.',
      },
      {
        href: '/admin/settings/authentication',
        icon: 'shield',
        title: 'Authentication',
        description:
          'Passcode expiry and attempt limits, session timeout and sign-in methods.',
      },
      {
        href: '/admin/settings/notifications',
        icon: 'bell',
        title: 'Notifications',
        description:
          'Which platform notifications are active. Set by a Director in Platform Settings.',
      },
    ],
  },
  {
    label: 'Organisation',
    areas: [
      {
        href: '/admin/settings/company',
        icon: 'building',
        title: 'Company',
        description:
          'Organisation name, support contacts, branding colours, tagline and logo.',
      },
    ],
  },
];

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        {/* The old subtitle described Integrations only. */}
        <p className="text-ink-muted">
          Administrative configuration for this organisation.
        </p>
      </header>

      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-subtle">
            {group.label}
          </h2>

          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            {group.areas.map((area) => (
              /*
               * The whole row is the link, and nothing inside it is separately
               * clickable — one hit target per row, no nested interactive
               * elements. Three columns at every width, so there is no
               * responsive reflow left to get wrong.
               */
              <Link
                key={area.href}
                href={area.href}
                className="group grid grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-start gap-x-3 px-4 py-3.5 transition-colors hover:bg-surface-sunken lg:min-h-[4.75rem] lg:items-center lg:gap-x-4 lg:px-5 lg:py-4"
              >
                <SettingsIcon
                  name={area.icon}
                  className="mt-0.5 h-5 w-5 text-ink-subtle lg:mt-0"
                />

                <span className="flex min-w-0 flex-col gap-0.5 lg:max-w-3xl">
                  <span className="text-base font-semibold text-ink">
                    {area.title}
                  </span>
                  <span className="text-sm text-ink-subtle">
                    {area.description}
                  </span>
                </span>

                <SettingsIcon
                  name="chevron"
                  strokeWidth={2}
                  className="mt-1 h-4 w-4 text-ink-subtle/70 transition-colors group-hover:text-ink-muted lg:mt-0"
                />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
