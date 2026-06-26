import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { getOnSiteNow } from '@/services/onsite/onSiteService';
import { formatDateTimeUK, formatTimeUK } from '@/lib/datetime';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

/**
 * Live "On Site Now" view: workers currently checked in (not yet checked out),
 * grouped by active site, with per-site compliance summaries. Auto-refreshes so
 * new check-ins appear and check-outs disappear without a manual reload.
 */
export default async function OnSitePage() {
  const snapshot = await getOnSiteNow();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">On site now</h1>
          <p className="text-ink-muted">
            {snapshot.totalCompliant} compliant · {snapshot.totalOnSite}{' '}
            currently on site across {snapshot.sites.length} active{' '}
            {snapshot.sites.length === 1 ? 'site' : 'sites'}.
          </p>
        </div>
        <AutoRefresh updatedLabel={formatTimeUK(snapshot.generatedAt)} />
      </header>

      <div className="space-y-4">
        {snapshot.sites.map((site) => (
          <section
            key={site.id}
            className="overflow-hidden rounded-xl border border-line bg-surface shadow-card"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-ink">{site.name}</h2>
                <p className="text-xs text-ink-subtle">
                  Ref {site.jobReference}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-sm font-semibold',
                  site.workers.length > 0
                    ? 'bg-safe-50 text-safe-700'
                    : 'bg-surface-sunken text-ink-subtle',
                )}
              >
                {site.compliantCount}/{site.workers.length} on site
              </span>
            </div>

            {site.workers.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-subtle">
                No one currently on site.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {site.workers.map((w) => (
                  <li
                    key={w.submissionId}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {w.fullName}
                      </p>
                      <p className="truncate text-sm text-ink-subtle">
                        {w.company}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className="hidden text-sm text-ink-muted sm:block"
                        title="Checked in"
                      >
                        {formatDateTimeUK(w.checkedInAt)}
                      </span>
                      <ComplianceBadge status={w.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ComplianceBadge({ status }: { status: 'COMPLIANT' | 'INCOMPLETE' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
        status === 'COMPLIANT'
          ? 'bg-safe-50 text-safe-700'
          : 'bg-danger-50 text-danger-700',
      )}
    >
      {status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
    </span>
  );
}
