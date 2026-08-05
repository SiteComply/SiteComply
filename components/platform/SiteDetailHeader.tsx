import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/platform/RecordHeader';
import {
  SITE_STATUS_LABEL,
  isProjectClosed,
  type SiteStatusValue,
} from '@/services/sites/siteStatusFilter';
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
import { canManageContractorAccess } from '@/services/platformUsers/contractorAccessService';
import { canGenerateCloseOutPack } from '@/services/closeOut/closeOutService';

/**
 * The three project-lifecycle workspaces — Project setup, CPP draft, Close-out
 * pack — share one definition so they cannot drift apart again.
 *
 * They had drifted: Project setup carried the brand outline while CPP draft and
 * Close-out pack were muted grey, which read as "the setup wizard matters and
 * these two are secondary". They are not secondary. Setting a project up,
 * drafting its Construction Phase Plan and closing it out are the same kind of
 * thing at three points in the same life: each opens a workspace assembled from
 * records the project already holds. Ranking them by colour told the reader
 * something untrue about the product.
 *
 * They stay OUTLINED, not filled: "Edit site" is the primary action on this
 * header and there can only be one. Archive keeps its own control, because it is
 * the destructive end of the row and must not look like a place to go and work.
 */
const PROJECT_WORKSPACE_ACTION =
  'touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50';

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
  // SC-022 — per-project contractor access. Shown only to the roles that may
  // configure it, so it isn't advertised to the contractors it governs.
  if (canManageContractorAccess(viewer.role))
    tabs.push({ key: 'access', label: 'Access' });

  return (
    <RecordHeader
      breadcrumbs={[
        { label: 'Sites', href: '/platform/dashboard/sites' },
        { label: site.name },
      ]}
      backHref="/platform/dashboard/sites"
      backLabel="Sites"
      title={site.name}
      badges={
        /* UX REFRESH PHASE 4 — this read `status === 'ACTIVE' ? 'Active' :
           'Archived'`, which pre-dates SC-025's COMPLETED status and therefore
           labelled a *completed* project "Archived" — a different thing, reached
           by a different workflow, with a different way back. Now uses the
           module's own SITE_STATUS_LABEL so a future status cannot be silently
           mislabelled here, and isProjectClosed decides the tone so Completed
           and Archived both read as closed without pretending to be the same. */
        <StatusPill
          label={SITE_STATUS_LABEL[site.status as SiteStatusValue]}
          tone={
            isProjectClosed(site.status as SiteStatusValue) ? 'muted' : 'good'
          }
        />
      }
      subtitle={`Ref ${site.jobReference} · ${site.town}, ${site.postcode}`}
      actions={
        canEdit && (
          <>
            {/* SC-019: the project setup wizard is where the CPP data lives.
                "Edit site" stays for the core operational fields. */}
            <Link
              href={`/platform/dashboard/sites/${site.id}/cpp`}
              className={PROJECT_WORKSPACE_ACTION}
            >
              CPP draft
            </Link>
            {/* SC-024 — sits beside the CPP: both are project documents
                assembled from records already held, and a manager reaching for
                one is likely to want the other. */}
            {canGenerateCloseOutPack(viewer.role) && (
              <Link
                href={`/platform/dashboard/sites/${site.id}/close-out`}
                className={PROJECT_WORKSPACE_ACTION}
              >
                Close-out pack
              </Link>
            )}
            <Link
              href={`/platform/dashboard/sites/${site.id}/setup`}
              className={PROJECT_WORKSPACE_ACTION}
            >
              Project setup
            </Link>
            {/* SC-025 — a completed project is read-only, so neither editing nor
                the archive/reactivate control is offered. Reactivating here would
                bypass the Director-only reopen flow, which requires a recorded
                reason and restores suspended worker access. */}
            {site.status !== 'COMPLETED' && (
              <>
                <Link
                  href={`/platform/dashboard/sites/${site.id}/edit`}
                  className="touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
                >
                  Edit site
                </Link>
                <SiteStatusButton siteId={site.id} status={site.status} />
              </>
            )}
          </>
        )
      }
    >
      <SiteDetailTabs siteId={site.id} tabs={tabs} active={active} />
    </RecordHeader>
  );
}
