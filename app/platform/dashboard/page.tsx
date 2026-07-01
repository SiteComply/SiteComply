import Link from 'next/link';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PreviewBanner } from '@/components/platform/PreviewBanner';
import { PlatformIcon, type PlatformIconName } from '@/components/platform/icons';

/**
 * Platform Dashboard (UI only).
 *
 * A high-level overview across an organisation's sites and compliance. All
 * figures below are realistic placeholder data for layout/navigation testing —
 * there is no authentication, database or backend behind this screen yet.
 */

type Chip = 'brand' | 'safe' | 'teal' | 'hivis' | 'danger';

const CHIP: Record<Chip, string> = {
  brand: 'bg-brand-50 text-brand-600',
  safe: 'bg-safe-50 text-safe-600',
  teal: 'bg-teal-50 text-teal-600',
  hivis: 'bg-hivis-400/20 text-hivis-600',
  danger: 'bg-danger-50 text-danger-600',
};

const CARDS: {
  title: string;
  value: string;
  sub: string;
  cta: string;
  href: string;
  icon: PlatformIconName;
  chip: Chip;
}[] = [
  {
    title: 'Active Sites',
    value: '12',
    sub: 'live across 4 regions',
    cta: 'Manage sites',
    href: '/platform/dashboard/sites',
    icon: 'pin',
    chip: 'brand',
  },
  {
    title: 'Workers On Site',
    value: '37',
    sub: 'checked in right now',
    cta: 'View check-ins',
    href: '/platform/dashboard/submissions',
    icon: 'hardhat',
    chip: 'safe',
  },
  {
    title: 'Open Actions',
    value: '5',
    sub: 'awaiting your attention',
    cta: 'See actions',
    href: '/platform/dashboard/actions',
    icon: 'bolt',
    chip: 'danger',
  },
  {
    title: 'Latest Reports',
    value: '6',
    sub: 'reports ready to view',
    cta: 'Open reports',
    href: '/platform/dashboard/reports',
    icon: 'chart',
    chip: 'teal',
  },
];

const RECENT_ACTIVITY = [
  { who: 'J. Okafor', what: 'checked in at Riverside Tower', when: '08:12' },
  { who: 'A. Nowak', what: 'submitted the daily site audit at Kings Wharf', when: '08:04' },
  { who: 'S. Patel', what: 'uploaded a method statement to Documents', when: 'Yesterday' },
  { who: 'L. Mensah', what: 'checked out of Brookfield Depot', when: 'Yesterday' },
];

export default function PlatformDashboardPage() {
  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Platform Dashboard</h1>
          <p className="text-ink-muted">
            A high-level view across your organisation’s sites and compliance.
          </p>
        </div>
        <span className="rounded-md bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600">
          Preview
        </span>
      </header>

      <PreviewBanner />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  CHIP[card.chip],
                )}
              >
                <PlatformIcon name={card.icon} />
              </span>
              <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Preview
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-ink">
              {card.value}
            </p>
            <p className="text-sm font-semibold text-ink">{card.title}</p>
            <p className="mt-0.5 flex-1 text-sm text-ink-subtle">{card.sub}</p>
            <span className="mt-3 text-sm font-semibold text-brand-700">
              {card.cta} →
            </span>
          </Link>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">Recent activity</h2>
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Preview
          </span>
        </div>
        <ul className="divide-y divide-line">
          {RECENT_ACTIVITY.map((row, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <span className="text-ink">
                <span className="font-semibold">{row.who}</span> {row.what}
              </span>
              <span className="shrink-0 tabular-nums text-ink-subtle">
                {row.when}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
