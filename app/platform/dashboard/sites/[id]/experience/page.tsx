import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { Section, Detail, Empty } from '@/components/platform/siteDetailUi';
import { SiteBulletins } from '@/components/platform/SiteBulletins';
import { SiteContacts } from '@/components/platform/SiteContacts';
import { WorkerDashboardConfig } from '@/components/platform/WorkerDashboardConfig';
import { KnowledgeCheckConfig } from '@/components/platform/KnowledgeCheckConfig';
import { InductionValidityConfig } from '@/components/platform/InductionValidityConfig';
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
}: {
  params: { id: string };
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

  const hasEmergency =
    site &&
    (site.fireAssemblyPoint ||
      site.firstAiderName ||
      site.firstAiderNumber ||
      site.firstAiderLocation ||
      site.nearestHospital ||
      site.emergencyNumber);

  return (
    <PlatformShell>
      <SiteDetailHeader
        viewer={viewer}
        siteId={params.id}
        active="experience"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {canViewBulletins && (
          <Section title="Daily Bulletins">
            <SiteBulletins
              siteId={params.id}
              bulletins={bulletins}
              canPublish={canPublishBulletins}
              canManage={canManageBulletins}
            />
          </Section>
        )}

        {panelVisibility && (
          <Section title="Worker dashboard">
            <WorkerDashboardConfig
              siteId={params.id}
              visibility={panelVisibility}
              canEdit={canConfigureDashboard}
            />
          </Section>
        )}

        {kcConfig && kcPreview && (
          <Section title="Knowledge check">
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
          </Section>
        )}

        {inductionValidity && (
          <Section title="Induction validity">
            <InductionValidityConfig
              siteId={params.id}
              canEdit={canConfigureDashboard}
              initial={{
                inductionValidityDays: inductionValidity.inductionValidityDays,
                invalidatedAtLabel: inductionValidity.inductionsInvalidatedAt
                  ? formatDateTimeUK(inductionValidity.inductionsInvalidatedAt)
                  : null,
                invalidatedByName: inductionValidity.invalidatedByName,
              }}
            />
          </Section>
        )}

        <Section title="Site contacts">
          <SiteContacts
            siteId={params.id}
            contacts={siteContacts}
            canEdit={canConfigureDashboard}
          />
        </Section>

        <Section title="Emergency information">
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
        </Section>
      </div>
    </PlatformShell>
  );
}
