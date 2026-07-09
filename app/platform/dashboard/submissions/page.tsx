import Link from 'next/link';
import { cn } from '@/lib/cn';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';

export const dynamic = 'force-dynamic';

/**
 * Platform → Submissions (check-ins). Lists check-in records for the viewer's
 * accessible sites only. The Export button follows the RBAC check-ins export
 * permission (hidden for Engineer and Client, who cannot export worker data).
 */
export default async function PlatformSubmissionsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'checkins');

  const canExport = permits(viewer.role, 'checkins', 'export');

  const submissions = viewer.siteIds.length
    ? await prisma.submission.findMany({
        where: { jobSiteId: { in: viewer.siteIds } },
        orderBy: { checkedInAt: 'desc' },
        take: 25,
        select: {
          id: true,
          checkedInAt: true,
          checkedOutAt: true,
          worker: { select: { id: true, fullName: true, company: true } },
          jobSite: { select: { name: true } },
        },
      })
    : [];

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Submissions</h1>
          <p className="text-ink-muted">
            Check-in and induction records across your sites.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
          {canExport && submissions.length > 0 && (
            <a
              href="/api/platform/submissions/export"
              className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Export CSV
            </a>
          )}
        </div>
      </header>

      {submissions.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          No check-ins recorded for your sites yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {submissions.map((s) => {
            const onSite = !s.checkedOutAt;
            return (
              <li key={s.id}>
                <Link
                  href={`/platform/dashboard/workers/${s.worker.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-brand-700">
                        {s.worker.fullName}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                          onSite
                            ? 'bg-safe-50 text-safe-700'
                            : 'border border-line bg-surface-sunken text-ink-muted',
                        )}
                      >
                        {onSite ? 'On site' : 'Checked out'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-subtle">
                      {s.worker.company} · {s.jobSite.name}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-xs tabular-nums text-ink-subtle">
                    {formatDateTimeUK(s.checkedInAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PlatformShell>
  );
}
