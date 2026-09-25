import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { AdminInductionVideoWorkspace } from '@/components/admin/AdminInductionVideoWorkspace';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Admin → Induction videos → Videos.
 *
 * Every project's induction video, and the way in to working on one. This was
 * read-only for a day, on the reasoning that generating and approving belonged to
 * the Platform user accountable for a project. The owner's decision is the
 * opposite and is now implemented throughout: an Admin Centre OWNER or ADMIN has
 * authority equivalent to a Platform Director, so each row leads to the project's
 * own page where a version can be generated, edited, approved, narrated,
 * rendered, published and withdrawn.
 *
 * Links stay INSIDE the Admin Centre. Pointing at the Platform's routes would be
 * a dead end for an administrator who holds no Platform account — which is why
 * this tier has its own project and version pages rather than borrowing them.
 */
export default async function AdminInductionVideosPage() {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  // Every active project, not a viewer's assigned subset: the Admin Centre is
  // organisation-wide by definition, and its site list already works this way.
  const sites = await prisma.jobSite.findMany({
    where: { status: 'ACTIVE' },
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
          version: true,
          status: true,
          approvedAt: true,
          approvedByName: true,
        },
      },
    },
  });

  return (
    <AdminInductionVideoWorkspace active="sites">
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
                      href={`/admin/induction-videos/projects/${s.id}`}
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
                  No active projects.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminInductionVideoWorkspace>
  );
}
