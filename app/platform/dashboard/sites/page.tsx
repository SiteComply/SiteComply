import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';

export const dynamic = 'force-dynamic';

/**
 * Platform → Sites. Lists only the sites the viewer may see: all sites for a
 * Director, otherwise their Assigned Sites. Non-assigned sites are never listed.
 * The Export button is shown only to roles permitted to export sites (Clients,
 * being read-only, do not see it).
 */
export default async function PlatformSitesPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const canExport = permits(viewer.role, 'sites', 'export');

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
        </div>
      </header>

      {viewer.sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          {viewer.allSites
            ? 'No sites have been created yet.'
            : 'You have no sites assigned yet. Ask an administrator to assign you to sites.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {viewer.sites.map((site) => (
            <li
              key={site.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-ink">
                    {site.name}
                  </span>
                  <StatusBadge status={site.status} />
                </div>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  Ref {site.jobReference} · {site.town}, {site.postcode}
                </p>
              </div>
            </li>
          ))}
        </ul>
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
