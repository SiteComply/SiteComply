import Link from 'next/link';
import { getAdminSession } from '@/lib/session';
import { getDashboardStats } from '@/services/dashboard/dashboardStatsService';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

/* Minimal line icons for the summary cards (inherit the accent via currentColor). */
const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-5 w-5',
  'aria-hidden': true,
} as const;

function HardHatIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M10 9V5.5a1.5 1.5 0 0 1 3 0V9" />
      <path d="M3 16h18" />
    </svg>
  );
}

function ClipboardCheckIcon() {
  return (
    <svg {...iconProps}>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <path d="m9.5 13 2 2 3.5-4" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

const CARDS = [
  {
    href: '/admin/sites',
    title: 'Job sites',
    body: 'Create and manage your sites, induction content and emergency information.',
    cta: 'Manage sites',
  },
  {
    href: '/admin/on-site',
    title: 'On site now',
    body: 'See who is currently checked in across your sites in real time.',
    cta: 'View who’s on site',
  },
  {
    href: '/admin/submissions',
    title: 'Submissions',
    body: 'Search, filter and export check-in records by site, worker and date.',
    cta: 'Browse submissions',
  },
] as const;

/**
 * Admin dashboard landing. An empty-state welcome that orients a new admin and
 * points to the main areas (built out in Stages 8–11).
 */
export default async function AdminDashboardPage() {
  const session = getAdminSession();
  const firstName = session?.name?.split(' ')[0] ?? 'there';
  const stats = await getDashboardStats();

  const summary = [
    {
      label: 'On site now',
      value: stats.onSiteNow,
      accent: 'text-safe-600',
      iconChip: 'bg-safe-50 text-safe-600',
      icon: <HardHatIcon />,
    },
    {
      label: 'Check-ins today',
      value: stats.checkInsToday,
      accent: 'text-brand-600',
      iconChip: 'bg-brand-50 text-brand-600',
      icon: <ClipboardCheckIcon />,
    },
    {
      label: 'Active sites',
      value: stats.activeSites,
      accent: 'text-teal-600',
      iconChip: 'bg-teal-50 text-teal-600',
      icon: <MapPinIcon />,
    },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Welcome, {firstName}</h1>
        <p className="text-ink-muted">
          This is your SiteComply admin dashboard. Get started by setting up a
          job site, then workers can check in from their phones.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-line bg-surface p-5 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink-subtle">
                {stat.label}
              </p>
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  stat.iconChip,
                )}
              >
                {stat.icon}
              </span>
            </div>
            <p
              className={cn(
                'mt-3 text-4xl font-bold tabular-nums tracking-tight',
                stat.accent,
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50"
          >
            <h2 className="text-base font-semibold text-ink">{card.title}</h2>
            <p className="mt-1 flex-1 text-sm text-ink-subtle">{card.body}</p>
            <span className="mt-3 text-sm font-semibold text-brand-700">
              {card.cta} →
            </span>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-line bg-surface p-6 text-center">
        <p className="text-sm text-ink-muted">
          Job site management, the induction builder, the live on-site view and
          reporting are added in the next build stages.
        </p>
      </div>
    </div>
  );
}
