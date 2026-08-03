import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { Detail, Empty } from '@/components/platform/siteDetailUi';
import { Panel } from '@/components/platform/Panel';
import {
  SectionWorkspace,
  resolveSection,
  type WorkspaceSection,
} from '@/components/platform/SectionWorkspace';
import { SiteBulletins } from '@/components/platform/SiteBulletins';
import { SiteContacts } from '@/components/platform/SiteContacts';
import { WorkerDashboardConfig } from '@/components/platform/WorkerDashboardConfig';
import { KnowledgeCheckConfig } from '@/components/platform/KnowledgeCheckConfig';
import { InductionValidityConfig } from '@/components/platform/InductionValidityConfig';
import { GpsCheckInConfig } from '@/components/platform/GpsCheckInConfig';
import { SiteInformationConfig } from '@/components/platform/SiteInformationConfig';
import { formatDateTimeUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getSiteForEditByViewer } from '@/services/sites/platformSiteService';
import { listBulletinsForSite } from '@/services/bulletins/bulletinService';
import { listSiteContactsForViewer } from '@/services/sites/siteContactService';
import { getPanelVisibilityForViewer } from '@/services/workerDashboard/dashboardConfigService';
import { getEffectiveConfig } from '@/services/knowledgeChecks/knowledgeCheckConfigService';
import { getBankPreviewForViewer } from '@/services/knowledgeChecks/bankAdminService';
import { getValidityForViewer } from '@/services/induction/inductionConfigService';
import {
  getGpsConfigForViewer,
  listRecentWorkersForViewer,
  listOverridesForViewer,
} from '@/services/geo/geoConfigService';
import { getSiteInformationForViewer } from '@/services/sites/siteInformationService';

export const dynamic = 'force-dynamic';

/**
 * Platform → Site Details — Worker Experience tab: everything that shapes what a
 * worker sees on site — Daily Bulletins (SC-002), Worker Dashboard settings
 * (SC-003), Knowledge Checks (SC-005), Induction Validity (SC-006), Site Contacts
 * and Emergency Information. Every panel keeps the exact permissions it had on the
 * former single page.
 */
export default async function SiteExperiencePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { section?: string | string[] };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const canViewBulletins = permits(viewer.role, 'bulletins', 'view');
  const canPublishBulletins = permits(viewer.role, 'bulletins', 'create');
  const canManageBulletins = permits(viewer.role, 'bulletins', 'edit');
  const canConfigureDashboard = permits(viewer.role, 'sites', 'edit');
  const canEdit = canEditSite(viewer.role);

  const site = await getSiteForEditByViewer(viewer, params.id);

  const bulletins = canViewBulletins
    ? (await listBulletinsForSite(viewer, params.id, 20)).map((b) => ({
        id: b.id,
        category: b.category,
        title: b.title,
        body: b.body,
        active: b.active,
        publishedAtLabel: formatDateTimeUK(b.publishedAt),
        createdByName: b.createdByName,
        readCount: b.readCount,
      }))
    : [];

  const [siteContacts, panelVisibility] = await Promise.all([
    listSiteContactsForViewer(viewer, params.id),
    getPanelVisibilityForViewer(viewer, params.id),
  ]);

  const [kcConfig, kcPreview, inductionValidity] = canConfigureDashboard
    ? await Promise.all([
        getEffectiveConfig(params.id),
        getBankPreviewForViewer(viewer, params.id),
        getValidityForViewer(viewer, params.id),
      ])
    : [null, null, null];

  // GPS check-in validation (SC-007): config + override management data.
  const [gpsConfig, gpsWorkers, gpsOverrides] = canConfigureDashboard
    ? await Promise.all([
        getGpsConfigForViewer(viewer, params.id),
        listRecentWorkersForViewer(viewer, params.id),
        listOverridesForViewer(viewer, params.id),
      ])
    : [null, [], []];

  // Site information (SC-008): structured worker-facing content + completeness.
  const siteInfo = canConfigureDashboard
    ? await getSiteInformationForViewer(viewer, params.id)
    : null;

  const hasEmergency =
    site &&
    (site.fireAssemblyPoint ||
      site.firstAiderName ||
      site.firstAiderNumber ||
      site.firstAiderLocation ||
      site.nearestHospital ||
      site.emergencyNumber);

  /**
   * UX REFRESH PHASE 3 — the eight panels are now one workspace.
   *
   * WHAT CHANGED: rendering only. Which sections exist is decided by exactly the
   * same expressions as before (`canViewBulletins`, `panelVisibility`,
   * `siteInfo`, …), every panel keeps its own save button and its own API call,
   * and the data loaded above is untouched — so this page fetches precisely what
   * it fetched before.
   *
   * WHY: eight panels in a two-column grid ran to 3,484px. Grid items stretch to
   * their row height, so a short panel beside a tall one left hundreds of pixels
   * of void, repeatedly. One section at a time removes the mismatch and the
   * scrolling together.
   *
   * The outer `Section` card is gone from each panel: the workspace already
   * renders the section's name, so wrapping a component that has its own internal
   * structure in a second titled card was framing for framing's sake.
   */
  const sections: WorkspaceSection[] = [
    canViewBulletins && {
      key: 'bulletins',
      label: 'Daily Bulletins',
      description: 'Notices and safety alerts shown to workers on this site.',
    },
    panelVisibility && {
      key: 'dashboard',
      label: 'Worker dashboard',
      description: 'What a worker sees after checking in to this site.',
    },
    siteInfo && {
      key: 'site-information',
      label: 'Site information',
      description: 'The worker-facing Site information page.',
    },
    kcConfig &&
      kcPreview && {
        key: 'knowledge-check',
        label: 'Knowledge check',
        description: 'The short quiz at the end of this site’s induction.',
      },
    inductionValidity && {
      key: 'induction-validity',
      label: 'Induction validity',
      description: 'How long a completed induction stays valid.',
    },
    gpsConfig && {
      key: 'check-in-location',
      label: 'Check-in location',
      description: 'Where a worker must be to check in.',
    },
    {
      key: 'contacts',
      label: 'Site contacts',
      description: 'Named people and numbers a worker may need to call.',
    },
    {
      key: 'emergency',
      label: 'Emergency information',
      description: 'Shown to every worker on this site.',
    },
  ].filter(Boolean) as WorkspaceSection[];

  const active = resolveSection(searchParams?.section, sections);
  const base = `/platform/dashboard/sites/${params.id}/experience`;

  return (
    <PlatformShell>
      <SiteDetailHeader
        viewer={viewer}
        siteId={params.id}
        active="experience"
      />

      <SectionWorkspace
        sections={sections}
        active={active}
        hrefFor={(key) => `${base}?section=${key}`}
        navLabel="Worker experience settings"
      >
        {active === 'bulletins' && canViewBulletins && (
          <SiteBulletins
            siteId={params.id}
            bulletins={bulletins}
            canPublish={canPublishBulletins}
            canManage={canManageBulletins}
          />
        )}

        {active === 'dashboard' && panelVisibility && (
          <WorkerDashboardConfig
            siteId={params.id}
            visibility={panelVisibility}
            canEdit={canConfigureDashboard}
          />
        )}

        {active === 'site-information' && siteInfo && (
          <SiteInformationConfig
            siteId={params.id}
            canEdit={canConfigureDashboard}
            siteEditHref={`/platform/dashboard/sites/${params.id}/edit`}
            initial={{
              workingHours: siteInfo.fields.workingHours ?? '',
              siteRules: siteInfo.fields.siteRules ?? '',
              welfareFacilities: siteInfo.fields.welfareFacilities ?? '',
              siteHazards: siteInfo.fields.siteHazards ?? '',
              emergencyProcedures: siteInfo.fields.emergencyProcedures ?? '',
              hasSiteMap: siteInfo.fields.hasSiteMap,
              siteMapFileName: siteInfo.fields.siteMapFileName,
              updatedByName: siteInfo.fields.updatedByName,
              updatedAtLabel: siteInfo.fields.updatedAt
                ? formatDateTimeUK(siteInfo.fields.updatedAt)
                : null,
            }}
            emergency={{
              fireAssemblyPoint: siteInfo.emergency.fireAssemblyPoint,
              firstAider:
                [
                  siteInfo.emergency.firstAiderName,
                  siteInfo.emergency.firstAiderLocation,
                  siteInfo.emergency.firstAiderNumber,
                ]
                  .filter(Boolean)
                  .join(' · ') || null,
              nearestHospital: siteInfo.emergency.nearestHospital,
              emergencyNumber: siteInfo.emergency.emergencyNumber,
            }}
            completeness={siteInfo.completeness}
          />
        )}

        {active === 'knowledge-check' && kcConfig && kcPreview && (
          <KnowledgeCheckConfig
            siteId={params.id}
            canEdit={canConfigureDashboard}
            initial={{
              enabled: kcConfig.enabled,
              questionsPerAttempt: kcConfig.questionsPerAttempt,
              requireManagerApproval: kcConfig.requireManagerApproval,
              unavailablePolicy: kcConfig.unavailablePolicy,
            }}
            preview={kcPreview}
          />
        )}

        {active === 'induction-validity' && inductionValidity && (
          <InductionValidityConfig
            siteId={params.id}
            canEdit={canConfigureDashboard}
            initial={{
              inductionValidityDays: inductionValidity.inductionValidityDays,
              invalidatedAtLabel: inductionValidity.inductionsInvalidatedAt
                ? formatDateTimeUK(inductionValidity.inductionsInvalidatedAt)
                : null,
              invalidatedByName: inductionValidity.invalidatedByName,
              signatureRequired: inductionValidity.signatureRequired,
            }}
          />
        )}

        {active === 'check-in-location' && gpsConfig && (
          <GpsCheckInConfig
            siteId={params.id}
            canEdit={canConfigureDashboard}
            initial={gpsConfig}
            workers={gpsWorkers}
            overrides={gpsOverrides.map((o) => ({
              id: o.id,
              workerName: o.workerName,
              company: o.company,
              reason: o.reason,
              grantedByName: o.grantedByName,
              createdAtLabel: formatDateTimeUK(o.createdAt),
              expiresAtLabel: o.expiresAt
                ? formatDateTimeUK(o.expiresAt)
                : null,
              status: o.status,
            }))}
          />
        )}

        {active === 'contacts' && (
          <SiteContacts
            siteId={params.id}
            contacts={siteContacts}
            canEdit={canConfigureDashboard}
          />
        )}

        {active === 'emergency' && (
          <Panel title="Emergency information">
            {hasEmergency ? (
              <dl className="space-y-3">
                {site!.fireAssemblyPoint && (
                  <Detail
                    label="Fire assembly point"
                    value={site!.fireAssemblyPoint}
                  />
                )}
                {site!.firstAiderName && (
                  <Detail
                    label="First aider"
                    value={[
                      site!.firstAiderName,
                      site!.firstAiderLocation
                        ? `at ${site!.firstAiderLocation}`
                        : null,
                      site!.firstAiderNumber
                        ? `· ${site!.firstAiderNumber}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                )}
                {site!.nearestHospital && (
                  <Detail label="Nearest A&E" value={site!.nearestHospital} />
                )}
                {site!.emergencyNumber && (
                  <Detail
                    label="Emergency number"
                    value={site!.emergencyNumber}
                  />
                )}
              </dl>
            ) : (
              <Empty>
                No emergency information has been added for this site.
              </Empty>
            )}
            {canEdit && (
              <Link
                href={`/platform/dashboard/sites/${params.id}/edit`}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                Edit emergency information →
              </Link>
            )}
          </Panel>
        )}
      </SectionWorkspace>
    </PlatformShell>
  );
}
