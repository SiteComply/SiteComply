import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { SiteStatusButton } from '@/components/platform/SiteStatusButton';
import { StatusPill } from '@/components/platform/siteDetailUi';
import {
  SiteDetailTabs,
  type SiteTab,
  type SiteTabKey,
} from '@/components/platform/SiteDetailTabs';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getSiteForEditByViewer } from '@/services/sites/platformSiteService';

/**
 * Shared chrome for every Site Details tab: breadcrumb, title, status, the
 * Director-only Edit / Archive actions, and the tab bar. Loaded once per tab from
 * a light site lookup (scoped to the viewer — out of scope → 404), so each tab
 * page only fetches the data for its own section. A shared component (not a
 * layout) so it doesn't wrap the separate Edit Site page.
 *
 * Which tabs appear is decided here by role, mirroring the per-section view
 * permissions of the former single page — a role never sees a tab whose content
 * it isn't entitled to. Overview keeps the original Site Details URL.
 */
export async function SiteDetailHeader({
  viewer,
  siteId,
  active,
}: {
  viewer: PlatformViewer;
  siteId: string;
  active: SiteTabKey;
}) {
  const site = await getSiteForEditByViewer(viewer, siteId);
  if (!site) notFound();

  const canEdit = canEditSite(viewer.role);
  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
  const canViewAudits = permits(viewer.role, 'audits', 'view');
  const canViewActions = permits(viewer.role, 'actions', 'view');
  const canViewDocuments = permits(viewer.role, 'documents', 'view');

  const tabs: SiteTab[] = [{ key: 'overview', label: 'Overview' }];
  if (canViewCheckins) tabs.push({ key: 'workers', label: 'Workers' });
  // Worker Experience always shows (site contacts + bulletins are visible to
  // every platform role; management panels within are permission-gated).
  tabs.push({ key: 'experience', label: 'Worker Experience' });
  if (canViewCheckins || canViewAudits || canViewActions)
    tabs.push({ key: 'compliance', label: 'Compliance' });
  if (canViewDocuments) tabs.push({ key: 'documents', label: 'Documents' });

  return (
    <div className="mb-6">
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: site.name },
        ]}
      />
      <Link
        href="/platform/dashboard/sites"
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        ← Sites
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">{site.name}</h1>
            <StatusPill
              label={site.status === 'ACTIVE' ? 'Active' : 'Archived'}
              tone={site.status === 'ACTIVE' ? 'good' : 'muted'}
            />
          </div>
          <p className="text-ink-muted">
            Ref {site.jobReference} · {site.town}, {site.postcode}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href={`/platform/dashboard/sites/${site.id}/edit`}
              className="touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
            >
              Edit site
            </Link>
            <SiteStatusButton siteId={site.id} status={site.status} />
          </div>
        )}
      </div>

      <SiteDetailTabs siteId={site.id} tabs={tabs} active={active} />
    </div>
  );
}
