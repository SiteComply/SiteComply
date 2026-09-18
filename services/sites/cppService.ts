import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { completenessFor } from '@/services/sites/siteSetupService';
import type {
  DerivedCompleteness,
  SectionStatus,
} from '@/services/sites/siteSetupCompletion';

/**
 * SC-019 Phase 2 — assemble a Construction Phase Plan DRAFT.
 *
 * Read-only by design. Every value comes from data already captured in Project
 * Setup (SC-019 Phase 1) and Site Information (SC-008) — nothing is stored, no
 * new columns, no snapshot. That is the single-source-of-truth requirement: the
 * CPP is a VIEW of the project record, so it can never drift from the data the
 * worker-facing pages show.
 *
 * It is deliberately a DRAFT. Software can assemble a CPP from captured data; it
 * cannot warrant that the plan is adequate or compliant — that remains the
 * Principal Contractor's duty under CDM 2015. The view says so, and so does the
 * printed output.
 *
 * Gaps are shown EXPLICITLY rather than silently omitted. A construction phase
 * plan with quiet holes in it is more dangerous than one that states plainly
 * which sections are still outstanding, so every empty section is labelled and
 * linked back to the wizard.
 */

export interface CppEntry {
  label: string;
  value: string | null;
}

export interface CppSection {
  key: string;
  title: string;
  /** Which wizard step fills this section, for the "complete this" link. */
  stepKey: string;
  entries: CppEntry[];
  /**
   * The section's real state, from the SAME computation the wizard and the
   * completeness figure use. Previously this was `empty`, derived here from
   * whether any entry had a value — a second opinion that could, and did,
   * disagree with the headline status printed a few lines above it.
   */
  status: SectionStatus;
  /** Required information not yet recorded, for the gap list. */
  missing: string[];
}

export interface CppDraft {
  site: {
    id: string;
    name: string;
    jobReference: string;
    address: string;
  };
  sections: CppSection[];
  /** Site layout drawings and emergency plans, filed as documents. */
  drawings: { id: string; title: string; fileName: string }[];
  completeness: DerivedCompleteness;
  /** Provenance for the printed document. */
  meta: {
    generatedAt: Date;
    generatedByName: string;
    lastUpdatedAt: Date | null;
    lastUpdatedByName: string | null;
  };
  /** Sections not yet complete — the gap list shown before the plan. */
  outstanding: { title: string; status: SectionStatus; missing: string[] }[];
}

/** Documents that belong in a CPP appendix — drawings and emergency plans. */
const DRAWING_TITLE_HINTS = ['drawing', 'layout', 'plan', 'emergency'];

export async function getCppDraft(
  viewer: PlatformViewer,
  siteId: string,
): Promise<CppDraft | null> {
  // Reading the CPP follows the ordinary sites view permission plus site scope.
  // There is no separate CPP right: if you can see the site, you can read its
  // plan. Editing stays where Phase 1 put it — this view has no writes at all,
  // which is how the Director/Site Manager ownership split is preserved.
  if (!permits(viewer.role, 'sites', 'view')) return null;
  if (!viewer.siteIds.includes(siteId)) return null;

  const site = await prisma.jobSite.findFirst({
    where: { id: siteId },
    include: {
      siteInformation: true,
      cdmDutyHolders: true,
      projectDetails: true,
      keyPeople: { orderBy: [{ kind: 'asc' }, { order: 'asc' }] },
      setupProgress: true,
      contacts: { orderBy: { order: 'asc' } },
      documents: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, fileName: true },
      },
    },
  });
  if (!site) return null;

  const info = site.siteInformation;
  const cdm = site.cdmDutyHolders;
  const proj = site.projectDetails;

  const fmtDate = (d: Date | null | undefined) =>
    d ? d.toLocaleDateString('en-GB') : null;
  const clean = (v: string | null | undefined) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };

  const people = (kind: string) =>
    site.keyPeople
      .filter((p) => p.kind === kind)
      .map((p) => [p.name, p.phone, p.location].filter(Boolean).join(' · '));

  /*
   * Status is NOT decided here. It is stamped on below from the one shared
   * computation, so a section cannot hold an opinion that differs from the
   * headline figure printed above it — which is precisely the contradiction
   * this change exists to remove.
   */
  const section = (
    key: string,
    title: string,
    stepKey: string,
    entries: CppEntry[],
  ): CppSection => ({
    key,
    title,
    stepKey,
    entries,
    status: 'EMPTY',
    missing: [],
  });

  const sections: CppSection[] = [
    section('project', 'Project description and programme', 'project', [
      { label: 'Project description', value: clean(proj?.description) },
      { label: 'Scope of works', value: clean(proj?.scopeOfWorks) },
      { label: 'Start date', value: fmtDate(proj?.startDate) },
      { label: 'Planned completion', value: fmtDate(proj?.plannedEndDate) },
      {
        label: 'CDM notifiable (F10)',
        value: proj ? (proj.cdmNotifiable ? 'Yes' : 'No') : null,
      },
      { label: 'F10 reference', value: clean(proj?.f10Reference) },
    ]),
    section('client', 'Client', 'client', [
      { label: 'Client', value: clean(cdm?.clientName) },
      { label: 'Contact', value: clean(cdm?.clientContactName) },
      { label: 'Email', value: clean(cdm?.clientContactEmail) },
      { label: 'Telephone', value: clean(cdm?.clientContactPhone) },
    ]),
    section('duty-holders', 'CDM 2015 duty holders', 'duty-holders', [
      { label: 'Principal Designer', value: clean(cdm?.principalDesigner) },
      { label: 'PD contact', value: clean(cdm?.principalDesignerContact) },
      { label: 'PD email', value: clean(cdm?.principalDesignerEmail) },
      { label: 'PD telephone', value: clean(cdm?.principalDesignerPhone) },
      {
        label: 'PD appointed',
        value: fmtDate(cdm?.principalDesignerAppointedAt),
      },
      { label: 'Principal Contractor', value: clean(cdm?.principalContractor) },
      { label: 'PC contact', value: clean(cdm?.principalContractorContact) },
      { label: 'PC email', value: clean(cdm?.principalContractorEmail) },
      { label: 'PC telephone', value: clean(cdm?.principalContractorPhone) },
      {
        label: 'PC appointed',
        value: fmtDate(cdm?.principalContractorAppointedAt),
      },
    ]),
    section('people', 'Site management and key personnel', 'people', [
      {
        label: 'Site managers',
        value: people('SITE_MANAGER').join('\n') || null,
      },
      {
        label: 'First aiders',
        value: people('FIRST_AIDER').join('\n') || null,
      },
      {
        label: 'Fire marshals',
        value: people('FIRE_MARSHAL').join('\n') || null,
      },
      { label: 'Other personnel', value: people('OTHER').join('\n') || null },
      {
        label: 'Site contacts',
        value:
          site.contacts
            .map((c) => [c.role, c.name, c.phone].filter(Boolean).join(' · '))
            .join('\n') || null,
      },
    ]),
    section('emergency', 'Emergency arrangements', 'emergency', [
      { label: 'Fire assembly point', value: clean(site.fireAssemblyPoint) },
      { label: 'Fire arrangements', value: clean(info?.fireArrangements) },
      {
        label: 'Emergency procedures',
        value: clean(info?.emergencyProcedures),
      },
      { label: 'Nearest A&E', value: clean(site.nearestHospital) },
      { label: 'Site emergency number', value: clean(site.emergencyNumber) },
    ]),
    section('welfare', 'Welfare facilities and working hours', 'welfare', [
      { label: 'Welfare facilities', value: clean(info?.welfareFacilities) },
      { label: 'Working hours', value: clean(info?.workingHours) },
    ]),
    section('rules', 'Site rules', 'rules', [
      { label: 'Site rules', value: clean(info?.siteRules) },
    ]),
    section('hazards', 'Hazards and existing site risks', 'hazards', [
      { label: 'Site-specific hazards', value: clean(info?.siteHazards) },
      { label: 'Existing site risks', value: clean(info?.existingSiteRisks) },
    ]),
    section('high-risk', 'High-risk activities', 'high-risk', [
      { label: 'High-risk activities', value: clean(info?.highRiskActivities) },
    ]),
    section('temporary-works', 'Temporary works', 'temporary-works', [
      { label: 'Temporary works', value: clean(info?.temporaryWorks) },
    ]),
    section('access', 'Site access, egress and deliveries', 'access', [
      { label: 'Access and egress', value: clean(info?.accessEgress) },
      { label: 'Delivery procedures', value: clean(info?.deliveryProcedures) },
    ]),
    section('traffic', 'Traffic management', 'traffic', [
      { label: 'Traffic management', value: clean(info?.trafficManagement) },
    ]),
    section('utilities', 'Utilities and isolation points', 'utilities', [
      {
        label: 'Utilities and isolation',
        value: clean(info?.utilitiesIsolation),
      },
    ]),
    section('environment', 'Environmental controls', 'environment', [
      {
        label: 'Environmental controls',
        value: clean(info?.environmentalControls),
      },
    ]),
  ];

  // Site layout drawings and emergency plans live in the Documents register
  // (Phase 1 decision), so the appendix references them rather than duplicating.
  const drawings = site.documents.filter((d) =>
    DRAWING_TITLE_HINTS.some(
      (h) =>
        d.title.toLowerCase().includes(h) ||
        d.fileName.toLowerCase().includes(h),
    ),
  );

  // Latest touch across the contributing records — provenance for the document.
  const stamps: { at: Date; by: string | null }[] = [];
  if (info) stamps.push({ at: info.updatedAt, by: info.updatedByName });
  if (cdm) stamps.push({ at: cdm.updatedAt, by: cdm.updatedByName });
  if (proj) stamps.push({ at: proj.updatedAt, by: proj.updatedByName });
  stamps.sort((a, b) => b.at.getTime() - a.at.getTime());

  const loaded = {
    ...site,
    siteInformation: info,
    cdmDutyHolders: cdm,
    projectDetails: proj,
  };

  // ONE computation, shared with the setup wizard and the completeness figure.
  const completeness = await completenessFor(loaded as never);

  /*
   * Stamp each section with its step's real status.
   *
   * A section whose step is not APPLICABLE to this site (temporary works on a
   * site with none) has no status entry and is not a gap — the old isRelevant()
   * check did this separately and is no longer needed, because applicableSteps
   * already decided it in one place.
   */
  for (const s of sections) {
    const st = completeness.statuses[s.stepKey];
    if (st) {
      s.status = st.status;
      s.missing = st.missing;
    } else {
      // Not applicable: nothing required, so nothing outstanding.
      s.status = 'COMPLETE';
    }
  }

  const applicableKeys = new Set(Object.keys(completeness.statuses));

  return {
    site: {
      id: site.id,
      name: site.name,
      jobReference: site.jobReference,
      address: [site.addressLine1, site.addressLine2, site.town, site.postcode]
        .filter(Boolean)
        .join(', '),
    },
    sections,
    drawings,
    completeness,
    meta: {
      generatedAt: new Date(),
      generatedByName: viewer.name,
      lastUpdatedAt: stamps[0]?.at ?? null,
      lastUpdatedByName: stamps[0]?.by ?? null,
    },
    outstanding: sections
      .filter((s) => applicableKeys.has(s.stepKey) && s.status !== 'COMPLETE')
      .map((s) => ({ title: s.title, status: s.status, missing: s.missing })),
  };
}

/*
 * isRelevant() was here. It re-derived the conditional flags to decide whether
 * an empty section counted as a gap — a third opinion alongside `empty` and
 * `cppReady`. applicableSteps() already answers that question for the wizard, so
 * the CPP now reads the same answer instead of computing its own.
 */
