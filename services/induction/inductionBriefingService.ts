import { DocumentCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getWorkerSiteInformation } from '@/services/sites/siteInformationService';
import { resolveArrangements } from '@/services/sites/arrangementService';
import { CPP_RISK_TOPICS, riskTopicMeta } from '@/services/sites/cppRiskTopics';
import { listActivePermitTypes } from '@/services/permits/permitCatalogService';
import { getWorkerDocuments } from '@/services/workerDashboard/workerDashboardService';
import {
  composeBriefing,
  type BriefingScreen,
  type BriefingSource,
} from '@/services/induction/inductionBriefing';

const CPP_RISK_INDEX = new Map(CPP_RISK_TOPICS.map((m, i) => [m.key, i]));

/**
 * Load the site briefing for the induction. READ ONLY - every source below is
 * data a manager has already entered: Site information, the emergency details,
 * the construction phase plan (duty holders, risk register, incident-reporting
 * arrangement), key people, permit types and the site's RAMS.
 *
 * The caller has already decided the operative may take this site's induction;
 * this function does not re-check access.
 */
/**
 * The site's briefing data, loaded once.
 *
 * SPLIT OUT so the induction VIDEO's scene rules read exactly the same source
 * as the briefing an operative is shown. Two loaders would drift, and the video
 * would eventually narrate something the induction screens do not say.
 */
export async function loadBriefingSource(
  siteId: string,
  siteName: string,
  siteCompanyId: string | null = null,
): Promise<BriefingSource | null> {
  const built = await buildSource(siteId, siteName, siteCompanyId);
  return built;
}

export async function getInductionBriefing(
  siteId: string,
  siteName: string,
  /**
   * The company the operative is engaged by on this project. Their RAMS are
   * their own plus anything site-wide; null shows site-wide only.
   */
  siteCompanyId: string | null = null,
): Promise<BriefingScreen[]> {
  const src = await buildSource(siteId, siteName, siteCompanyId);
  return src ? composeBriefing(src) : [];
}

async function buildSource(
  siteId: string,
  siteName: string,
  siteCompanyId: string | null,
): Promise<BriefingSource | null> {
  const [
    base,
    info,
    project,
    duty,
    keyPeople,
    risks,
    arrangements,
    permitTypes,
    rams,
    site,
  ] = await Promise.all([
    getWorkerSiteInformation(siteId),
    prisma.siteInformation.findUnique({ where: { jobSiteId: siteId } }),
    prisma.siteProjectDetails.findUnique({
      where: { jobSiteId: siteId },
      select: { description: true, scopeOfWorks: true },
    }),
    prisma.cdmDutyHolders.findUnique({
      where: { jobSiteId: siteId },
      select: { principalContractor: true, clientName: true },
    }),
    prisma.siteKeyPerson.findMany({
      where: { jobSiteId: siteId },
      orderBy: { order: 'asc' },
      select: { kind: true, name: true, phone: true, location: true },
    }),
    prisma.siteRiskTopic.findMany({
      where: { jobSiteId: siteId, applicable: true },
      select: { topic: true, controls: true },
    }),
    resolveArrangements(siteId),
    listActivePermitTypes(siteId),
    getWorkerDocuments(siteId, { category: DocumentCategory.RAMS, siteCompanyId }),
    prisma.jobSite.findUnique({
      where: { id: siteId },
      select: { inductionContent: true },
    }),
  ]);
  if (!base) return null;

  // The plan's own order (L153 Appendix 3), not whatever order rows came back in.
  const riskOrder = (key: string) => {
    const meta = riskTopicMeta(key);
    return meta ? CPP_RISK_INDEX.get(meta.key) ?? 999 : 999;
  };

  return {
    siteId,
    siteName,
    address: base.address,
    jobReference: base.jobReference,
    inductionNotes: site?.inductionContent ?? null,
    project: project ?? null,
    duty: duty
      ? { principalContractor: duty.principalContractor, client: duty.clientName }
      : null,
    siteManager: base.siteManager,
    emergency: base.emergency,
    keyPeople: keyPeople.map((p) => ({ ...p, kind: String(p.kind) })),
    info: {
      workingHours: info?.workingHours ?? null,
      welfareFacilities: info?.welfareFacilities ?? null,
      siteHazards: info?.siteHazards ?? null,
      emergencyProcedures: info?.emergencyProcedures ?? null,
      existingSiteRisks: info?.existingSiteRisks ?? null,
      temporaryWorks: info?.temporaryWorks ?? null,
      trafficManagement: info?.trafficManagement ?? null,
      deliveryProcedures: info?.deliveryProcedures ?? null,
      accessEgress: info?.accessEgress ?? null,
      environmentalControls: info?.environmentalControls ?? null,
      utilitiesIsolation: info?.utilitiesIsolation ?? null,
      highRiskActivities: info?.highRiskActivities ?? null,
      fireArrangements: info?.fireArrangements ?? null,
      hasSiteMap: Boolean(info?.siteMapBlobPath),
    },
    incidentReporting:
      arrangements.find((a) => a.key === 'INCIDENT_REPORTING')?.content ?? null,
    risks: risks
      .slice()
      .sort((a, b) => riskOrder(String(a.topic)) - riskOrder(String(b.topic)))
      .map((r) => ({
        label: riskTopicMeta(String(r.topic))?.label ?? String(r.topic),
        controls: r.controls,
      })),
    permitTypes: permitTypes.map((p) => p.name),
    ramsDocuments: rams.map((d) => ({ id: d.id, title: d.title })),
  };
}
