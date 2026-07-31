import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getSetupForSite } from '@/services/sites/siteSetupService';
import { getSiteServiceConfig } from '@/services/siteServices/siteServiceAvailability';
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
    people: {},
    services: {},
  };

  // SC-021 — the site's permit and inspection availability, with the conflicts
  // that block a disable, so the step can explain a refusal before it happens.
  const serviceGroups = (await getSiteServiceConfig(viewer, site.id)) ?? [];

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
        canEditProject={canEditSite(viewer.role)}
        serviceGroups={serviceGroups}
      />
    </PlatformShell>
  );
}
