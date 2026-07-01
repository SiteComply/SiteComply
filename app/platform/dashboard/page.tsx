import Link from 'next/link';
import { cn } from '@/lib/cn';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon, type PlatformIconName } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';

export const dynamic = 'force-dynamic';

/**
 * Platform Dashboard.
 *
 * All figures are scoped to the signed-in viewer's accessible sites (Directors
 * see all sites; everyone else only their Assigned Sites). Non-assigned sites
 * never contribute to any count or list. Role-based permissions are not enforced.
 */

type Chip = 'brand' | 'safe' | 'teal' | 'danger';

const CHIP: Record<Chip, string> = {
  brand: 'bg-brand-50 text-brand-600',
  safe: 'bg-safe-50 text-safe-600',
  teal: 'bg-teal-50 text-teal-600',
  danger: 'bg-danger-50 text-danger-600',
};

export default async function PlatformDashboardPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'dashboard');
  const { siteIds } = viewer;

  // Everything below is filtered to the viewer's accessible sites only.
  const activeSites = viewer.sites.filter((s) => s.status === 'ACTIVE').length;

  const [workersOnSite, recent] = siteIds.length
    ? await Promise.all([
        prisma.submission.count({
          where: { jobSiteId: { in: siteIds }, checkedOutAt: null },
        }),
        prisma.submission.findMany({
          where: { jobSiteId: { in: siteIds } },
          orderBy: { checkedInAt: 'desc' },
          take: 5,
          select: {
            id: true,
            checkedInAt: true,
            worker: { select: { fullName: true } },
            jobSite: { select: { name: true } },
          },
        }),
      ])
    : [0, [] as never[]];

  const cards: {
    title: string;
    value: number;
    sub: string;
    cta: string;
    href: string;
    icon: PlatformIconName;
    chip: Chip;
  }[] = [
    {
      title: 'Active Sites',
      value: activeSites,
      sub: viewer.allSites ? 'across the organisation' : 'assigned to you',
      cta: 'View sites',
      href: '/platform/dashboard/sites',
      icon: 'pin',
      chip: 'brand',
    },
    {
      title: 'Workers On Site',
      value: workersOnSite,
      sub: 'checked in right now',
      cta: 'View check-ins',
      href: '/platform/dashboard/submissions',
      icon: 'hardhat',
      chip: 'safe',
    },
    {
      title: 'Open Actions',
      value: 0,
      sub: 'awaiting your attention',
      cta: 'See actions',
      href: '/platform/dashboard/actions',
      icon: 'bolt',
      chip: 'danger',
    },
    {
      title: 'Latest Reports',
      value: 0,
      sub: 'ready to view',
      cta: 'Open reports',
      href: '/platform/dashboard/reports',
      icon: 'chart',
      chip: 'teal',
    },
  ];

  return (
    <PlatformShell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Platform Dashboard</h1>
        <p className="text-ink-muted">
          A high-level view across your organisation’s sites and compliance.
        </p>
      </header>

      <ScopeBanner viewer={viewer} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40"
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                CHIP[card.chip],
              )}
            >
              <PlatformIcon name={card.icon} />
            </span>
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
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">Recent activity</h2>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No recent check-ins across your sites.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span className="min-w-0 truncate text-ink">
                  <span className="font-semibold">{row.worker.fullName}</span>{' '}
                  checked in at {row.jobSite.name}
                </span>
                <span className="shrink-0 tabular-nums text-ink-subtle">
                  {formatDateTimeUK(row.checkedInAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PlatformShell>
  );
}

function ScopeBanner({
  viewer,
}: {
  viewer: { allSites: boolean; siteIds: string[] };
}) {
  const n = viewer.siteIds.length;
  return (
    <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-ink">
      {viewer.allSites ? (
        <>
          Showing <strong>all {n} site{n === 1 ? '' : 's'}</strong> across your
          organisation (Director access).
        </>
      ) : n === 0 ? (
        <>
          You have <strong>no sites assigned</strong> yet. Ask an administrator to
          assign you to sites to see data here.
        </>
      ) : (
        <>
          Showing data for your{' '}
          <strong>
            {n} assigned site{n === 1 ? '' : 's'}
          </strong>
          .
        </>
      )}
    </div>
  );
}
