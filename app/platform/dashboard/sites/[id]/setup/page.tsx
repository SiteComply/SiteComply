import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getSetupForSite } from '@/services/sites/siteSetupService';
import {
  getSiteRules,
  siteRulesAreAcknowledged as rulesStillAcknowledged,
  SITE_RULE_LIBRARY,
} from '@/services/checklists/siteRulesService';

import {
  getSitePpeRequirements,
  DEFAULT_PPE,
} from '@/services/checklists/sitePpeService';
import { getRiskRegister } from '@/services/sites/cppRiskService';
import { countRisksMissingControls } from '@/services/sites/siteSetupService';
import {
  canIssueInductionModule,
  moduleDecisionsForSite,
} from '@/services/inductionModules/inductionModuleService';
import { libraryDecisionsForSite } from '@/services/inductionVideo/libraryAssetService';
import { manifestForSite } from '@/services/inductionVideo/scriptService';
import { formatRunningTime } from '@/services/inductionVideo/captions';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { prisma } from '@/lib/prisma';
import { DocumentCategory } from '@prisma/client';
import { getSiteServiceConfig } from '@/services/siteServices/siteServiceAvailability';
import { listActiveConfigTemplates } from '@/services/siteServices/siteConfigTemplateService';
import {
  SiteSetupWizard,
  type KeyPersonRow,
  type SetupValues,
} from '@/components/platform/SiteSetupWizard';

export const dynamic = 'force-dynamic';

/** yyyy-mm-dd for a date input, or '' when unset. */
function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

/**
 * SC-019 Phase 1 — project setup wizard page.
 *
 * Needs `sites:edit` to open at all (Site Managers hold it); the Director-owned
 * project steps are additionally gated inside the wizard and the service, so a
 * Site Manager sees the appointments read-only rather than not at all.
 *
 * Every value is read from the model that already owns it — SiteInformation,
 * JobSite, CdmDutyHolders, SiteProjectDetails, SiteKeyPerson — never from a
 * parallel copy. That is the single-source-of-truth requirement.
 */
export default async function SiteSetupPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!permits(viewer.role, 'sites', 'edit')) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const site = await getSetupForSite(viewer, params.id);
  if (!site) notFound();

  // The rules section's completion requirement lives in the Site Rules Library,
  // not in this wizard's free-text field — so the count has to come with it.
  const siteRules = await getSiteRules(site.id);

  const info = site.siteInformation;
  const cdm = site.cdmDutyHolders;
  const project = site.projectDetails;

  const initialValues: SetupValues = {
    project: {
      description: project?.description ?? '',
      scopeOfWorks: project?.scopeOfWorks ?? '',
      startDate: dateInput(project?.startDate),
      plannedEndDate: dateInput(project?.plannedEndDate),
      cdmNotifiable: project?.cdmNotifiable === true,
    },
    f10: { f10Reference: project?.f10Reference ?? '' },
    client: {
      clientName: cdm?.clientName ?? '',
      clientContactName: cdm?.clientContactName ?? '',
      clientContactEmail: cdm?.clientContactEmail ?? '',
      clientContactPhone: cdm?.clientContactPhone ?? '',
    },
    'duty-holders': {
      principalDesigner: cdm?.principalDesigner ?? '',
      principalDesignerContact: cdm?.principalDesignerContact ?? '',
      principalDesignerEmail: cdm?.principalDesignerEmail ?? '',
      principalDesignerPhone: cdm?.principalDesignerPhone ?? '',
      principalDesignerAppointedAt: dateInput(
        cdm?.principalDesignerAppointedAt,
      ),
      principalContractor: cdm?.principalContractor ?? '',
      principalContractorContact: cdm?.principalContractorContact ?? '',
      principalContractorEmail: cdm?.principalContractorEmail ?? '',
      principalContractorPhone: cdm?.principalContractorPhone ?? '',
      principalContractorAppointedAt: dateInput(
        cdm?.principalContractorAppointedAt,
      ),
    },
    emergency: {
      fireAssemblyPoint: site.fireAssemblyPoint ?? '',
      nearestHospital: site.nearestHospital ?? '',
      emergencyNumber: site.emergencyNumber ?? '',
      fireArrangements: info?.fireArrangements ?? '',
      emergencyProcedures: info?.emergencyProcedures ?? '',
    },
    welfare: {
      welfareFacilities: info?.welfareFacilities ?? '',
      workingHours: info?.workingHours ?? '',
    },
    rules: { siteRules: info?.siteRules ?? '' },
    hazards: {
      siteHazards: info?.siteHazards ?? '',
      existingSiteRisks: info?.existingSiteRisks ?? '',
    },
    'high-risk': { highRiskActivities: info?.highRiskActivities ?? '' },
    'temporary-works': { temporaryWorks: info?.temporaryWorks ?? '' },
    access: {
      accessEgress: info?.accessEgress ?? '',
      deliveryProcedures: info?.deliveryProcedures ?? '',
    },
    traffic: { trafficManagement: info?.trafficManagement ?? '' },
    utilities: { utilitiesIsolation: info?.utilitiesIsolation ?? '' },
    environment: { environmentalControls: info?.environmentalControls ?? '' },
    drawings: {},
    // The notes move here from the Director-only site record.
    induction: { inductionContent: site.inductionContent ?? '' },
    risks: {},
    people: {},
    services: {},
  };

  // SC-021 — the site's permit and inspection availability, with the conflicts
  // that block a disable, so the step can explain a refusal before it happens.
  const serviceGroups = (await getSiteServiceConfig(viewer, site.id)) ?? [];

  /*
   * EVERYTHING THE HOSTED EDITORS NEED.
   *
   * The risk register, the site rules, the PPE list, the site map and the company
   * content are all edited inside this wizard now, by the components that already
   * own them. They save themselves through their own endpoints, so this page only
   * has to hand them their current state.
   */
  const [
    register,
    ppeItems,
    risksMissingControls,
    rulesAcknowledged,
    ramsCount,
    manifest,
  ] = await Promise.all([
    getRiskRegister(site.id),
    getSitePpeRequirements(site.id),
    countRisksMissingControls(site.id),
    rulesStillAcknowledged(site.id),
    prisma.document.count({
      where: { jobSiteId: site.id, category: DocumentCategory.RAMS },
    }),
    manifestForSite(site.id),
  ]);
  /*
   * The company content the finished induction will carry. The overlap note needs
   * the scene types this project's own records produce, which is what the manifest
   * is - the same input the induction-video screen uses, so the two agree.
   */
  const [moduleDecisions, libraryDecisions] = await Promise.all([
    moduleDecisionsForSite(site.id, (manifest?.scenes ?? []).map((sc: { sceneType: string }) => sc.sceneType)),
    libraryDecisionsForSite(site.id),
  ]);
  // SC-021 Phase 2 — templates the manager can apply from inside the wizard.
  const configTemplates = (await listActiveConfigTemplates()).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category as string,
  }));

  const initialPeople: KeyPersonRow[] = site.keyPeople.map((p) => ({
    kind: p.kind,
    name: p.name,
    phone: p.phone ?? '',
    location: p.location ?? '',
  }));

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: site.name, href: `/platform/dashboard/sites/${site.id}` },
          { label: 'Project setup' },
        ]}
      />
      <SiteSetupWizard
        siteId={site.id}
        siteName={site.name}
        initialValues={initialValues}
        initialPeople={initialPeople}
        completedSteps={site.setupProgress?.completedSteps ?? []}
        siteRuleCount={siteRules.length}
        ppeItemCount={ppeItems.length}
        risksMissingControls={risksMissingControls}
        riskTopics={register.rows}
        ruleItems={siteRules}
        ruleLibrary={SITE_RULE_LIBRARY}
        rulesAcknowledged={rulesAcknowledged}
        ppeItems={ppeItems}
        ppeDefaults={DEFAULT_PPE}
        siteMap={{
          hasSiteMap: Boolean(site.siteInformation?.siteMapBlobPath),
          siteMapFileName: site.siteInformation?.siteMapFileName ?? null,
        }}
        ramsCount={ramsCount}
        moduleDecisions={moduleDecisions.map((d) => ({
          moduleId: d.moduleId,
          slug: d.slug,
          title: d.title,
          mandatory: d.mandatory,
          issuedVersion: d.issuedVersion,
          companyHeading: d.companyHeading,
          companyNarration: d.companyNarration,
          state: d.state,
          included: d.included,
          overrideNarration: d.overrideNarration,
          reason: d.reason,
          decidedByName: d.decidedByName,
          displacedBySiteContent: d.displacedBySiteContent,
        }))}
        libraryDecisions={libraryDecisions.map((d) => ({
          assetId: d.assetId,
          title: d.title,
          description: d.description,
          placement: d.placement,
          mandatory: d.mandatory,
          issuedVersion: d.issuedVersion,
          durationLabel: d.durationMs ? formatRunningTime(d.durationMs) : null,
          included: d.included,
          effectivelyIncluded: d.effectivelyIncluded,
          reason: d.reason,
          decidedByName: d.decidedByName,
          decidedByRealm: describeRealm(d.decidedByRealm),
          replacesModuleTitle: d.replacesModuleTitle,
        }))}
        canOverrideModules={canIssueInductionModule(viewer.role)}
        canEditProject={canEditSite(viewer.role)}
        serviceGroups={serviceGroups}
        configTemplates={configTemplates}
      />
    </PlatformShell>
  );
}
