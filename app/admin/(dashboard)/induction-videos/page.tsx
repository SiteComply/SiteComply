import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { AdminInductionVideoWorkspace } from '@/components/admin/AdminInductionVideoWorkspace';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Admin → Induction videos → Videos — READ-ONLY, and that is the design.
 *
 * An administrator needs to see the state of every project's induction video:
 * which exist, which are waiting on someone, which have never been started. What
 * they do not need is a second way to generate, approve or publish one. That work
 * belongs against a project, with the Platform user who is accountable for it, and
 * a second approval path would split the record of who approved what.
 *
 * So this mirrors the Platform's listing exactly in shape and terminology, and
 * offers no actions. `adminReadOnly` on the shared area definition is where that
 * decision is recorded.
 *
 * It also earns the nav entry. Showing "Videos" in the tab strip and then having
 * it lead nowhere would be worse than not mirroring the Platform at all.
 *
 * Deliberately NOT linked through to the Platform's per-project pages: an
 * administrator may hold no Platform account, so those links would be dead ends.
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
    <AdminInductionVideoWorkspace active="videos">
      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        Read-only. Induction videos are generated, approved and published against a
        project in the Platform, by the person accountable for that project.
      </p>

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
                    <span className="font-semibold text-ink">{s.name}</span>
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
