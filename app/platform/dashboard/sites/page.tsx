import {
  SITE_STATUS_LABEL,
  type SiteStatusValue,
} from '@/services/sites/siteStatusFilter';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import { SegmentedNav } from '@/components/platform/navUi';
import {
  permits,
  canCreateSite,
} from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  SITE_STATUS_FILTERS,
  parseSiteStatusFilter,
  filterSitesByStatus,
  siteStatusCounts,
} from '@/services/sites/siteStatusFilter';

export const dynamic = 'force-dynamic';

/**
 * Platform → Sites. Lists only the sites the viewer may see: all sites for a
 * Director, otherwise their Assigned Sites. Non-assigned sites are never listed.
 *
 * A status filter (All / Active / Archived, default All) narrows the visible
 * sites via the `?status=` query param. It only ever narrows the already-scoped
 * list, so RBAC and site-scoping are preserved; because the page is dynamic, an
 * archive/reactivate is reflected in the filter immediately. The Export button is
 * shown only to roles permitted to export sites (Clients, being read-only, do
 * not see it).
 */
export default async function PlatformSitesPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const canExport = permits(viewer.role, 'sites', 'export');
  const canCreate = canCreateSite(viewer.role);

  const status = parseSiteStatusFilter(searchParams.status);
  const counts = siteStatusCounts(viewer.sites);
  const sites = filterSitesByStatus(viewer.sites, status);

  return (
    <PlatformShell>
      <PageHeader
        title="Sites"
        description="The job sites you have access to across your organisation."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
        actions={
          <>
            {canExport && viewer.sites.length > 0 && (
              <a
                href="/api/platform/sites/export"
                className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Export CSV
              </a>
            )}
            {canCreate && (
              <Link
                href="/platform/dashboard/sites/new"
                className="touch-target inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  +
                </span>
                New Site
              </Link>
            )}
          </>
        }
      />

      {viewer.sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          {viewer.allSites
            ? 'No sites have been created yet.'
            : 'You have no sites assigned yet. Ask an administrator to assign you to sites.'}
        </p>
      ) : (
        <>
          {/* UX REFRESH PHASE 9 — this strip was a card sitting directly on top
              of the table's card, so one list arrived as two stacked panels and
              the filter competed with the data it filters. It is now the shared
              recessed control, in the same language as the table toolbar. Same
              hrefs, same status values, same counts. */}
          <SegmentedNav
            label="Filter sites by status"
            items={SITE_STATUS_FILTERS.map((f) => ({
              key: f.value,
              label: f.label,
              href:
                f.value === 'all'
                  ? '/platform/dashboard/sites'
                  : `/platform/dashboard/sites?status=${f.value}`,
              active: f.value === status,
              count: counts[f.value],
            }))}
          />

          {sites.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
              {status === 'active'
                ? 'No active sites.'
                : status === 'archived'
                  ? 'No archived sites.'
                  : 'No sites to show.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {sites.map((site) => (
                <li key={site.id}>
                  <Link
                    href={`/platform/dashboard/sites/${site.id}`}
                    className="hover:border-brand-300 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:bg-brand-50/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-brand-700">
                          {site.name}
                        </span>
                        <StatusBadge status={site.status} />
                      </div>
                      <p className="mt-0.5 text-sm text-ink-subtle">
                        Ref {site.jobReference} · {site.town}, {site.postcode}
                      </p>
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-brand-400 shrink-0"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PlatformShell>
  );
}

// A completed project reads differently from an archived one: archived is a
// soft hide, completed is a formally closed, read-only project.
const STATUS_BADGE_CLASS: Record<SiteStatusValue, string> = {
  ACTIVE: 'bg-safe-50 text-safe-700',
  COMPLETED: 'bg-brand-700/10 text-brand-700',
  ARCHIVED: 'border border-line bg-surface-sunken text-ink-muted',
};

function StatusBadge({ status }: { status: SiteStatusValue }) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        STATUS_BADGE_CLASS[status],
      )}
    >
      {SITE_STATUS_LABEL[status]}
    </span>
  );
}
