import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageInductionVideos } from '@/services/inductionVideo/inductionVideoPermissions';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';

export const dynamic = 'force-dynamic';

/**
 * Induction videos, across the viewer's projects.
 *
 * ONE ROW PER PROJECT, not per version. A manager wants to know which sites
 * have an induction video, which are waiting on them, and which are missing
 * information — the version history belongs on the project's own page.
 */
export default async function InductionVideosPage() {
  const viewer = await requirePlatformViewer();
  if (!canManageInductionVideos(viewer.role)) redirect('/platform/dashboard');
  if (viewer.siteIds.length === 0) redirect('/platform/dashboard');

  const sites = await prisma.jobSite.findMany({
    where: { id: { in: viewer.siteIds }, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      jobReference: true,
      town: true,
      inductionVideos: {
        orderBy: { version: 'desc' },
        take: 1,
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          approvedAt: true,
          approvedByName: true,
        },
      },
    },
  });

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[{ label: 'Induction videos' }]}
      />
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">Induction videos</h1>
        <p className="text-sm text-ink-muted">
          Built from each project’s own records: the site decides what the
          induction must cover, and nothing is added that has not been entered.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-sunken text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="px-5 py-3 font-semibold">Project</th>
              <th className="px-5 py-3 font-semibold">Latest version</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sites.map((s) => {
              const latest = s.inductionVideos[0];
              return (
                <tr key={s.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/platform/dashboard/sites/${s.id}/induction-video`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="block text-xs text-ink-subtle">
                      {s.jobReference} · {s.town}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted">
                    {latest ? `Version ${latest.version}` : '—'}
                  </td>
                  <td className="px-5 py-3">
                    {latest ? (
                      <InductionVideoStatusBadge status={latest.status} />
                    ) : (
                      <span className="text-xs text-ink-subtle">Not started</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-muted">
                    {latest?.approvedAt
                      ? `${formatDateTimeUK(latest.approvedAt)} · ${latest.approvedByName ?? ''}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
            {sites.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-ink-muted">
                  No active projects in your access.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}
