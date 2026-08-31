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
 * in a fixed order, the eye runs down a single rail of icons, and the status
 * column lines up so it can be read as a column rather than four separate
 * sentences.
 *
 * Adding an area is a row. Adding a group is a label and a container. Keep
 * descriptions to one line — two is the ceiling; if a section needs three, its
 * name is wrong.
 */

/**
 * Status vocabulary. A marker appears ONLY when the state is not nominal —
 * healthy is plain text, and there are deliberately no green ticks. If every
 * row carried a marker the one that matters would be one of four, instead of
 * the only coloured pixel on the page.
 *
 *   text      — nominal. A plain value summary.
 *   attention — working, but not in the state it should be in for live use.
 *   pill      — ownership rather than health; must not read as a fault.
 */
type SettingsStatus =
  | { kind: 'text'; label: string }
  | { kind: 'attention'; label: string }
  | { kind: 'pill'; label: string };

type SettingsArea = {
  href: string;
  icon: SettingsIconName;
  title: string;
  description: string;
  status: SettingsStatus;
};

/**
 * STATUS TEXT IS STATIC. Nothing here reads live configuration — that was a
 * deliberate scoping decision, so these strings are the SHAPE the reads should
 * return, not the result of one.
 *
 * Two of them are therefore claims this page cannot currently verify:
 * "Using built-in defaults" is wrong the moment an admin saves an
 * authentication change, and "Profile and branding set" is wrong for an
 * organisation that has not set them.
 *
 * "CSCS onboarding pending" is the one with a shelf life. It describes where
 * the organisation is in onboarding rather than which provider is wired, which
 * is the right thing to say to an admin — but it is still a fixed string, so
 * **delete it when Smart Check onboarding completes** (docs/CSCS-CUTOVER.md)
 * or the page will keep reporting a pending step that is done. Replacing all
 * three with real reads is the follow-up.
 */
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
        status: { kind: 'attention', label: 'CSCS onboarding pending' },
      },
      {
        href: '/admin/settings/authentication',
        icon: 'shield',
        title: 'Authentication',
        description:
          'Passcode expiry and attempt limits, session timeout and sign-in methods.',
        status: { kind: 'text', label: 'Using built-in defaults' },
      },
      {
        href: '/admin/settings/notifications',
        icon: 'bell',
        title: 'Notifications',
        description:
          'Which platform notifications are active. Set by a Director in Platform Settings.',
        status: { kind: 'pill', label: 'Read-only' },
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
        status: { kind: 'text', label: 'Profile and branding set' },
      },
    ],
  },
];

function StatusCell({ status }: { status: SettingsStatus }) {
  if (status.kind === 'pill') {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-subtle">
        {status.label}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm text-ink-muted">
      {status.kind === 'attention' && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-hivis-500"
          aria-hidden="true"
        />
      )}
      {status.label}
    </span>
  );
}

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
               * elements. Below lg the status leaves its column and sits under
               * the description rather than being squeezed or truncated.
               */
              <Link
                key={area.href}
                href={area.href}
                className="group grid grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-start gap-x-3 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-surface-sunken lg:min-h-[4.75rem] lg:grid-cols-[1.25rem_minmax(0,1fr)_17.5rem_1rem] lg:items-center lg:gap-x-4 lg:gap-y-0 lg:px-5 lg:py-4"
              >
                <SettingsIcon
                  name={area.icon}
                  className="col-start-1 row-start-1 mt-0.5 h-5 w-5 text-ink-subtle lg:mt-0"
                />

                <span className="col-start-2 row-start-1 flex min-w-0 flex-col gap-0.5">
                  <span className="text-base font-semibold text-ink">
                    {area.title}
                  </span>
                  <span className="text-sm text-ink-subtle">
                    {area.description}
                  </span>
                </span>

                <span className="col-start-2 row-start-2 min-w-0 lg:col-start-3 lg:row-start-1">
                  <StatusCell status={area.status} />
                </span>

                <SettingsIcon
                  name="chevron"
                  strokeWidth={2}
                  className="col-start-3 row-start-1 mt-1 h-4 w-4 text-ink-subtle/70 transition-colors group-hover:text-ink-muted lg:col-start-4 lg:mt-0"
                />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
