import Link from 'next/link';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
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
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Sites</h1>
          <p className="text-ink-muted">
            The job sites you have access to across your organisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
          {canExport && viewer.sites.length > 0 && (
            <a
              href="/api/platform/sites/export"
              className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Export CSV
            </a>
          )}
          {/* SC-021 Phase 2 — the shared configuration template library. */}
          <Link
            href="/platform/dashboard/sites/config-templates"
            className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Configuration templates
          </Link>
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
        </div>
      </header>

      {viewer.sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          {viewer.allSites
            ? 'No sites have been created yet.'
            : 'You have no sites assigned yet. Ask an administrator to assign you to sites.'}
        </p>
      ) : (
        <>
          <nav
            aria-label="Filter sites by status"
            className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-card"
          >
            {SITE_STATUS_FILTERS.map((f) => {
              const active = f.value === status;
              return (
                <Link
                  key={f.value}
                  href={
                    f.value === 'all'
                      ? '/platform/dashboard/sites'
                      : `/platform/dashboard/sites?status=${f.value}`
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
                    {counts[f.value]}
                  </span>
                </Link>
              );
            })}
          </nav>

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

function StatusBadge({ status }: { status: 'ACTIVE' | 'ARCHIVED' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        status === 'ACTIVE'
          ? 'bg-safe-50 text-safe-700'
          : 'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {status === 'ACTIVE' ? 'Active' : 'Archived'}
    </span>
  );
}
