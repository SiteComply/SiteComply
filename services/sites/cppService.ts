import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { completenessFor } from '@/services/sites/siteSetupService';
import { getSiteRules } from '@/services/checklists/siteRulesService';
import { getSitePpeRequirements } from '@/services/checklists/sitePpeService';
import { getSiteServiceConfig } from '@/services/siteServices/siteServiceAvailability';
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

/** A listed item — a rule, a PPE requirement, a RAMS document, a permit type. */
export interface CppItem {
  label: string;
  detail: string | null;
}

export interface CppSection {
  key: string;
  title: string;
  /** Which wizard step fills this section, for the "complete this" link. */
  stepKey: string | null;
  /** Where this content is maintained, when it is not a setup step. */
  manageHref: string | null;
  entries: CppEntry[];
  /** List content, where the section is a register rather than prose. */
  items: CppItem[];
  /**
   * Whether this section's state feeds the completion figure.
   *
   * TRUE for the setup-owned sections, which is where completion has always
   * lived. FALSE for sections wired from elsewhere in the platform — PPE, RAMS,
   * permits, induction, competence, monitoring. Those are REFERENCE content:
   * they make the plan a fuller document without changing what a site must do
   * to be "complete", so adding them cannot move anybody's percentage. Promoting
   * any of them to a requirement is a deliberate, separate decision.
   */
  gatesCompletion: boolean;
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

/**
 * Access requirements in the language of a construction phase plan.
 *
 * The enum names are internal; a duty holder reading the plan needs to know what
 * is actually enforced at the gate, in words they would use themselves.
 */
/** Schedule frequencies in plain words, for the printed plan. */
/** The four ScheduleFrequency values, and only those — see prisma/schema. */
const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  CUSTOM: 'To a custom schedule',
};

const ACCESS_REQUIREMENT_LABELS: Record<string, string> = {
  CSCS_VERIFIED:
    'A valid CSCS/ECS card, verified against the CSCS Smart Check service',
  CSCS_IN_DATE: 'A card that is in date',
  KNOWLEDGE_CHECK_PASSED: 'A passed site knowledge check',
  INDUCTION_VALID: 'A current, valid site induction',
  SIGNATURE_ON_FILE: 'A signed induction declaration on file',
};

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

  /*
   * TIER 1 — content that already exists in the platform, surfaced here instead
   * of being asked for a second time.
   *
   * Every one of these is maintained on its own screen by the people who own it,
   * so the plan stays current without anybody retyping it into a CPP field —
   * the same single-source rule the setup sections follow. Nothing here is
   * captured for the CPP's benefit, and nothing here is stored.
   */
  const [rules, ppe, serviceGroups, inductionCfg, accessReqs, ramsDocs, schedules] =
    await Promise.all([
      getSiteRules(siteId),
      getSitePpeRequirements(siteId),
      getSiteServiceConfig(viewer, siteId),
      prisma.siteInductionConfig.findUnique({ where: { jobSiteId: siteId } }),
      prisma.siteAccessRequirement.findMany({
        where: { jobSiteId: siteId, enabled: true },
        select: { requirement: true },
      }),
      prisma.document.findMany({
        where: { jobSiteId: siteId, category: 'RAMS' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, fileName: true, createdAt: true },
      }),
      prisma.complianceSchedule.findMany({
        where: { jobSiteId: siteId, active: true },
        orderBy: { title: 'asc' },
        select: {
          title: true,
          frequency: true,
          assignedRole: true,
          auditTemplate: { select: { name: true } },
        },
      }),
    ]);

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
  /** A setup-owned section. Its status comes from the setup completion model. */
  const section = (
    key: string,
    title: string,
    stepKey: string,
    entries: CppEntry[],
  ): CppSection => ({
    key,
    title,
    stepKey,
    manageHref: null,
    entries,
    items: [],
    status: 'EMPTY',
    missing: [],
    gatesCompletion: true,
  });

  /**
   * A section wired from data maintained elsewhere in the platform.
   *
   * Reference content: it never gates completion, so surfacing it cannot move a
   * site's percentage. Its status is simply whether there is anything to show —
   * an honest "none recorded" rather than a silent omission, which is the same
   * rule the setup sections have always followed.
   */
  const wired = (
    key: string,
    title: string,
    manageHref: string | null,
    items: CppItem[],
    entries: CppEntry[] = [],
  ): CppSection => ({
    key,
    title,
    stepKey: null,
    manageHref,
    entries,
    items,
    status:
      items.length > 0 || entries.some((e) => e.value !== null)
        ? 'COMPLETE'
        : 'EMPTY',
    missing: [],
    gatesCompletion: false,
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
    /* ---- Wired: how people get on to this site, and on what basis. ---- */
    wired(
      'induction',
      'Site induction arrangements',
      `/platform/dashboard/sites/${siteId}/experience`,
      [],
      [
        {
          label: 'Induction',
          value:
            'Every operative completes a site induction before first access, delivered and recorded in SiteComply.',
        },
        {
          label: 'Knowledge check',
          value: inductionCfg
            ? inductionCfg.knowledgeCheckEnabled
              ? `Required — ${inductionCfg.questionsPerAttempt} question${inductionCfg.questionsPerAttempt === 1 ? '' : 's'} per attempt, all must be answered correctly.`
              : 'Not used on this site.'
            : null,
        },
        {
          label: 'Signed declaration',
          value: inductionCfg
            ? inductionCfg.inductionSignatureRequired
              ? 'Required — the operative signs the induction record, which is retained.'
              : 'Not required on this site.'
            : null,
        },
        {
          label: 'Manager approval',
          value: inductionCfg
            ? inductionCfg.requireManagerApproval
              ? 'A site manager approves each operative before access is granted.'
              : 'Not required on this site.'
            : null,
        },
        {
          label: 'Re-induction',
          value: inductionCfg
            ? inductionCfg.inductionValidityDays
              ? `Induction is valid for ${inductionCfg.inductionValidityDays} days, after which the operative is re-inducted.`
              : 'Induction is confirmed at every check-in.'
            : null,
        },
      ],
    ),
    /*
     * COMPETENCE. Stated as what is ENFORCED at the gate, not as an aspiration —
     * these are the checks a worker actually has to pass, read from the site's
     * own access requirements rather than described in prose that could drift
     * from them.
     */
    wired(
      'competence',
      'Competence and site access requirements',
      `/platform/dashboard/sites/${siteId}/access`,
      accessReqs.map((r) => ({
        label: ACCESS_REQUIREMENT_LABELS[r.requirement] ?? r.requirement,
        detail: null,
      })),
      [
        {
          label: 'Card checking',
          value:
            'CSCS/ECS card details are captured at induction and verified against the CSCS Smart Check service.',
        },
        {
          label: 'Enforcement',
          value:
            accessReqs.length === 0
              ? 'No access requirements are enforced on this site — card details are recorded but do not block access.'
              : null,
        },
      ],
    ),
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
    /*
     * SITE RULES COME FROM THE LIBRARY.
     *
     * This printed `SiteInformation.siteRules` — the free-text field that was
     * renamed "Additional site information" precisely because it is NOT the
     * rule set. A site using the Library correctly produced a plan with an empty
     * rules section, while a site with no published rules could look complete.
     * The Library items are what an operative is shown and acknowledges at
     * induction, so they are what the plan states; the free text follows as
     * supplementary notes, exactly as it does on the worker's screen.
     */
    {
      ...wired(
        'rules',
        'Site rules',
        `/platform/dashboard/sites/${siteId}/experience`,
        rules.map((r) => ({ label: r.label, detail: r.helpText })),
        [{ label: 'Additional site information', value: clean(info?.siteRules) }],
      ),
      // Kept pointing at the setup step so "complete this" still leads somewhere
      // sensible, without gating completion on it.
      stepKey: null,
    },
    wired(
      'ppe',
      'Personal protective equipment',
      `/platform/dashboard/sites/${siteId}/experience`,
      ppe.map((r) => ({
        label: r.label,
        detail: [r.required ? 'Mandatory' : 'As required by task', r.helpText]
          .filter(Boolean)
          .join(' — ') || null,
      })),
      [
        {
          label: 'Confirmation',
          value:
            ppe.length > 0
              ? 'Each operative confirms they hold and will wear the PPE listed above as part of their site induction.'
              : null,
        },
      ],
    ),
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
    wired(
      'permits',
      'Permit-to-work arrangements',
      `/platform/dashboard/sites/${siteId}/experience`,
      (serviceGroups ?? [])
        .filter((g) => g.kind === 'PERMIT_TYPE')
        .flatMap((g) => g.items)
        .filter((i) => i.enabled)
        .map((i) => ({ label: i.name, detail: i.description })),
      [
        {
          label: 'Arrangements',
          value:
            'Work of the types listed above may not begin until a permit has been requested through SiteComply and approved. Each permit records who requested it, who approved it and when.',
        },
      ],
    ),
    wired(
      'rams',
      'Risk assessments and method statements',
      `/platform/dashboard/sites/${siteId}/documents`,
      ramsDocs.map((d) => ({
        label: d.title,
        detail: `${d.fileName} · filed ${d.createdAt.toLocaleDateString('en-GB')}`,
      })),
      [
        {
          label: 'Arrangements',
          value:
            ramsDocs.length > 0
              ? 'The risk assessments and method statements listed above are held in the site document register and are available to operatives on site.'
              : null,
        },
      ],
    ),
    section('environment', 'Environmental controls', 'environment', [
      {
        label: 'Environmental controls',
        value: clean(info?.environmentalControls),
      },
    ]),
    wired(
      'monitoring',
      'Monitoring and inspection arrangements',
      `/platform/dashboard/sites/${siteId}/compliance`,
      schedules.map((sch) => ({
        label: sch.title,
        detail: [
          sch.auditTemplate?.name,
          FREQUENCY_LABELS[sch.frequency] ?? sch.frequency,
          sch.assignedRole ? `assigned to ${sch.assignedRole}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      [
        {
          label: 'Arrangements',
          value:
            schedules.length > 0
              ? 'The inspections above are scheduled in SiteComply, which raises each one when due and records the result. Findings raise actions with an owner and a due date, tracked to closure.'
              : 'No recurring inspections are scheduled for this site.',
        },
      ],
    ),
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
    // A wired section decided its own status when it was built, from whether
    // there is anything to show. Completion belongs to the setup steps.
    if (!s.gatesCompletion || s.stepKey === null) continue;
    const st = completeness.statuses[s.stepKey];
    if (st) {
      s.status = st.status;
      s.missing = st.missing;
    } else {
      // Not applicable to this site: nothing required, so nothing outstanding.
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
      .filter(
        (s) =>
          s.gatesCompletion &&
          s.stepKey !== null &&
          applicableKeys.has(s.stepKey) &&
          s.status !== 'COMPLETE',
      )
      .map((s) => ({ title: s.title, status: s.status, missing: s.missing })),
  };
}

/*
 * isRelevant() was here. It re-derived the conditional flags to decide whether
 * an empty section counted as a gap — a third opinion alongside `empty` and
 * `cppReady`. applicableSteps() already answers that question for the wizard, so
 * the CPP now reads the same answer instead of computing its own.
 */
