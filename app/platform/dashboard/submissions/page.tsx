import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatDateTimeUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  CHECKIN_STATUS_FILTERS,
  parseCheckinStatusFilter,
  type CheckinStatusFilter,
} from '@/services/submissions/checkinFilter';
import {
  getCheckinCounts,
  listCheckinsForViewer,
} from '@/services/submissions/checkinListService';

export const dynamic = 'force-dynamic';

/**
 * Platform → Check-ins. Lists worker site check-in records for the viewer's
 * accessible sites only, with All / On site / Checked out status filter tabs
 * (default All) carrying live, viewer-scoped counts — mirroring the Sites status
 * filter. The Export button follows the RBAC check-ins export permission (hidden
 * for Engineer and Client) and exports the full scoped set regardless of filter.
 * (The route path stays /submissions to preserve existing URLs/bookmarks.)
 */
export default async function PlatformSubmissionsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'checkins');

  const canExport = permits(viewer.role, 'checkins', 'export');
  const status = parseCheckinStatusFilter(searchParams.status);

  const [counts, submissions] = await Promise.all([
    getCheckinCounts(viewer),
    listCheckinsForViewer(viewer, status),
  ]);

  const countByFilter: Record<CheckinStatusFilter, number> = {
    all: counts.all,
    'on-site': counts.onSite,
    'checked-out': counts.checkedOut,
  };

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Check-ins</h1>
          <p className="text-ink-muted">
            Worker site check-in and induction records across your sites.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
          {canExport && counts.all > 0 && (
            <a
              href="/api/platform/submissions/export"
              className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Export CSV
            </a>
          )}
        </div>
      </header>

      {counts.all === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          No check-ins recorded for your sites yet.
        </p>
      ) : (
        <>
          <nav
            aria-label="Filter check-ins by status"
            className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-card"
          >
            {CHECKIN_STATUS_FILTERS.map((f) => {
              const active = f.value === status;
              return (
                <Link
                  key={f.value}
                  href={
                    f.value === 'all'
                      ? '/platform/dashboard/submissions'
                      : `/platform/dashboard/submissions?status=${f.value}`
                  }
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-ink-muted hover:bg-surface-sunken',
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                      active
                        ? 'bg-white/25 text-white'
                        : 'bg-surface-sunken text-ink-subtle',
                    )}
                  >
                    {countByFilter[f.value]}
                  </span>
                </Link>
              );
            })}
          </nav>

          {submissions.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
              {status === 'on-site'
                ? 'No workers are currently on site.'
                : status === 'checked-out'
                  ? 'No checked-out check-ins.'
                  : 'No check-ins to show.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {submissions.map((s) => {
                const onSite = !s.checkedOutAt;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/platform/dashboard/workers/${s.worker.id}`}
                      className="hover:border-brand-300 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:bg-brand-50/40"
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
        </>
      )}
    </PlatformShell>
  );
}
