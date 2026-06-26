import Link from 'next/link';
import { getAdminSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

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
export default function AdminDashboardPage() {
  const session = getAdminSession();
  const firstName = session?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Welcome, {firstName}</h1>
        <p className="text-ink-muted">
          This is your SiteComply admin dashboard. Get started by setting up a
          job site, then workers can check in from their phones.
        </p>
      </header>

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
