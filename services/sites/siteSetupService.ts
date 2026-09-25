import { SiteKeyPersonKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import {
  isSetupStepKey,
  type SetupFlag,
} from '@/services/sites/siteSetupConstants';
import {
  computeDerivedCompleteness,
  type DerivedCompleteness,
  type SetupSnapshot,
} from '@/services/sites/siteSetupCompletion';
import { getSiteRules } from '@/services/checklists/siteRulesService';
import { getSitePpeRequirements } from '@/services/checklists/sitePpeService';

/**
 * SC-019 Phase 1 — the project setup wizard's server side.
 *
 * SINGLE SOURCE OF TRUTH is the governing rule. Every step writes to the model
 * that already owns that data:
 *   - narrative CPP content  → SiteInformation (SC-008, extended)
 *   - emergency / first aider → JobSite's existing columns
 *   - appointments            → CdmDutyHolders (new; legally structured)
 *   - programme               → SiteProjectDetails (new)
 *   - named personnel         → SiteKeyPerson (new; generalises the single aider)
 * Nothing is copied into a parallel CPP store, so the worker-facing Site
 * Information page, the induction, the dashboard and the Construction Phase Plan
 * all read the same rows and cannot diverge.
 *
 * OWNERSHIP SPLIT: project-level steps need `canEditSite` (Director); operational
 * steps need `sites:edit`, which Site Managers hold — exactly the split SC-008
 * established.
 */

export type SetupResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/** Everything the wizard and the completeness indicator need, in one read. */
export async function getSetupForSite(viewer: PlatformViewer, siteId: string) {
  if (!viewer.siteIds.includes(siteId)) return null;
  return prisma.jobSite.findFirst({
    where: { id: siteId },
    include: {
      siteInformation: true,
      cdmDutyHolders: true,
      projectDetails: true,
      keyPeople: { orderBy: [{ kind: 'asc' }, { order: 'asc' }] },
      setupProgress: true,
    },
  });
}

type LoadedSite = NonNullable<Awaited<ReturnType<typeof getSetupForSite>>>;

/**
 * The conditional flags that decide which steps apply.
 *
 * ONE FLAG LEFT. F10 is a legal notification that either applies or does not, and
 * the project step asks that question outright.
 *
 * The three site-condition flags are gone. They were derived from whether the
 * matching textarea was already non-empty, so the step that collects the detail
 * only appeared once somebody had filled it in - which meant nothing ever asked.
 * Those steps are always shown now and ask directly; the answers live on
 * SiteInformation.hasTemporaryWorks / hasTrafficManagement / hasHighRiskActivities.
 */
export function deriveFlags(
  site: LoadedSite,
): Partial<Record<SetupFlag, boolean>> {
  return {
    cdmNotifiable: site.projectDetails?.cdmNotifiable === true,
  };
}

/**
 * The server's view of the wizard's form values.
 *
 * THE ONE PLACE THE TWO SIDES COULD DRIFT. The wizard evaluates completion from
 * `values[stepKey][fieldName]` in React state; this rebuilds that exact shape
 * from the saved rows so both reach the same verdict. Every key here must match
 * the field `name` in SiteSetupWizard's STEP_FIELDS — a typo would silently make
 * a required field permanently unsatisfiable on the server while the wizard
 * showed it green. `setup_completion_verify` asserts the two agree field by
 * field rather than trusting this comment.
 *
 * Dates are emitted as YYYY-MM-DD because that is what the date inputs hold.
 */
export function buildSetupSnapshot(
  site: LoadedSite,
  siteRuleCount: number,
  /**
   * Counts that live outside the site's own rows.
   *
   * PPE is a versioned checklist item and the risk shortfall is computed from the
   * register, so neither can be read off `LoadedSite`. They are passed in rather
   * than fetched here so this stays a pure mapping the wizard can mirror exactly -
   * the whole reason the two sides agree.
   */
  extra: { ppeItems: number; risksMissingControls: number } = {
    ppeItems: 0,
    risksMissingControls: 0,
  },
): SetupSnapshot {
  const info = site.siteInformation;
  const cdm = site.cdmDutyHolders;
  const proj = site.projectDetails;
  const iso = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : null;

  return {
    values: {
      project: {
        description: proj?.description ?? null,
        scopeOfWorks: proj?.scopeOfWorks ?? null,
        startDate: iso(proj?.startDate),
        plannedEndDate: iso(proj?.plannedEndDate),
        // Only an ANSWER counts. A site with no projectDetails row has not said
        // "no" — it has not been asked, which is not the same thing.
        cdmNotifiable: proj ? proj.cdmNotifiable : null,
      },
      f10: { f10Reference: proj?.f10Reference ?? null },
      client: {
        clientName: cdm?.clientName ?? null,
        clientContactName: cdm?.clientContactName ?? null,
        clientContactEmail: cdm?.clientContactEmail ?? null,
        clientContactPhone: cdm?.clientContactPhone ?? null,
      },
      'duty-holders': {
        principalDesigner: cdm?.principalDesigner ?? null,
        principalContractor: cdm?.principalContractor ?? null,
      },
      emergency: {
        fireAssemblyPoint: site.fireAssemblyPoint ?? null,
        nearestHospital: site.nearestHospital ?? null,
        emergencyNumber: site.emergencyNumber ?? null,
        fireArrangements: info?.fireArrangements ?? null,
        emergencyProcedures: info?.emergencyProcedures ?? null,
      },
      welfare: {
        welfareFacilities: info?.welfareFacilities ?? null,
        workingHours: info?.workingHours ?? null,
      },
      rules: { siteRules: info?.siteRules ?? null },
      hazards: {
        siteHazards: info?.siteHazards ?? null,
        existingSiteRisks: info?.existingSiteRisks ?? null,
      },
      'high-risk': {
        highRiskActivities: info?.highRiskActivities ?? null,
        hasHighRiskActivities: info?.hasHighRiskActivities ?? null,
      },
      'temporary-works': {
        temporaryWorks: info?.temporaryWorks ?? null,
        // Null until asked. `false` is an answer; see SiteInformation.
        hasTemporaryWorks: info?.hasTemporaryWorks ?? null,
      },
      access: {
        accessEgress: info?.accessEgress ?? null,
        deliveryProcedures: info?.deliveryProcedures ?? null,
      },
      traffic: {
        trafficManagement: info?.trafficManagement ?? null,
        hasTrafficManagement: info?.hasTrafficManagement ?? null,
      },
      utilities: { utilitiesIsolation: info?.utilitiesIsolation ?? null },
      environment: { environmentalControls: info?.environmentalControls ?? null },
      /*
       * The register is edited in place and saves itself, so this step holds no
       * fields of its own - only the record that a manager has been through it,
       * which is what `reviewed` is. The shortfall that actually matters is the
       * count below.
       */
      risks: {
        reviewed: (site.setupProgress?.completedSteps ?? []).includes('risks')
          ? true
          : null,
      },
    },
    counts: {
      siteManagers: site.keyPeople.filter(
        (p) => p.kind === SiteKeyPersonKind.SITE_MANAGER,
      ).length,
      firstAiders: site.keyPeople.filter(
        (p) => p.kind === SiteKeyPersonKind.FIRST_AIDER,
      ).length,
      siteRules: siteRuleCount,
      ppeItems: extra.ppeItems,
      risksMissingControls: extra.risksMissingControls,
    },
  };
}

/**
 * Completion for a site, derived from its data.
 *
 * `completedSteps` is now the REVIEWED list and is passed through for display
 * only — it no longer contributes to `percent`, `outstanding` or `cppReady`.
 * Async because the rules requirement reads the Site Rules Library; the old
 * signature was synchronous, which is why every caller changed.
 */
export async function completenessFor(
  site: LoadedSite,
): Promise<DerivedCompleteness> {
  const [rules, ppe, risksMissingControls] = await Promise.all([
    getSiteRules(site.id),
    getSitePpeRequirements(site.id),
    countRisksMissingControls(site.id),
  ]);
  return computeDerivedCompleteness(
    deriveFlags(site),
    buildSetupSnapshot(site, rules.length, {
      ppeItems: ppe.length,
      risksMissingControls,
    }),
    site.setupProgress?.completedSteps ?? [],
  );
}

/**
 * Risks the register says APPLY here with no control measures written.
 *
 * The one condition that refuses to generate an induction video, counted here so
 * setup can say so before somebody tries. `applicable` is deliberately three-state
 * in the register - null means nobody has decided - and only an explicit `true`
 * demands controls: an undecided risk is an unanswered question, which the
 * step's own "reviewed" requirement covers.
 */
export async function countRisksMissingControls(siteId: string): Promise<number> {
  const rows = await prisma.siteRiskTopic.findMany({
    where: { jobSiteId: siteId, applicable: true },
    select: { controls: true },
  });
  return rows.filter((r) => !(r.controls && r.controls.trim())).length;
}

/** Project-level steps are Director-only; operational steps follow sites:edit. */
function mayEditStep(viewer: PlatformViewer, stepKey: string): boolean {
  const projectLevel = ['project', 'client', 'duty-holders', 'f10'];
  if (projectLevel.includes(stepKey)) return canEditSite(viewer.role);
  return permits(viewer.role, 'sites', 'edit');
}

/** A tri-state answer. Undefined stays undefined: silence is not "no". */
const bool = (v: unknown): boolean | null | undefined =>
  v === true || v === false ? v : undefined;

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export interface SaveStepInput {
  stepKey: string;
  values: Record<string, unknown>;
  /**
   * Whether to record that the user has REVIEWED this step.
   *
   * Was `markComplete`, and was the bug: it asserted completion without the
   * server ever looking at the values, so a step could be "complete" with every
   * field blank. Completion is now derived from the data in
   * siteSetupCompletion; this flag is a tracking marker only and makes no
   * compliance claim, which is why it is still accepted on an incomplete step.
   */
  markReviewed: boolean;
}

/**
 * Save one wizard step. Deliberately one entry point rather than a route per
 * step, so authorisation, scoping and the progress record are handled once.
 */
export async function saveSetupStep(
  viewer: PlatformViewer,
  siteId: string,
  input: SaveStepInput,
): Promise<SetupResult> {
  if (!isSetupStepKey(input.stepKey)) {
    return { ok: false, reason: 'invalid', error: 'Unknown setup step.' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, reason: 'not_found' };
  }
  if (!mayEditStep(viewer, input.stepKey)) {
    return { ok: false, reason: 'forbidden' };
  }
  const site = await prisma.jobSite.findFirst({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const v = input.values;
  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };

  switch (input.stepKey) {
    case 'project': {
      const data = {
        description: text(v.description),
        scopeOfWorks: text(v.scopeOfWorks),
        startDate: date(v.startDate),
        plannedEndDate: date(v.plannedEndDate),
        cdmNotifiable: v.cdmNotifiable === true || v.cdmNotifiable === 'true',
        ...stamp,
      };
      await prisma.siteProjectDetails.upsert({
        where: { jobSiteId: siteId },
        update: data,
        create: { jobSiteId: siteId, ...data },
      });
      break;
    }
    case 'f10': {
      await prisma.siteProjectDetails.upsert({
        where: { jobSiteId: siteId },
        update: { f10Reference: text(v.f10Reference), ...stamp },
        create: {
          jobSiteId: siteId,
          f10Reference: text(v.f10Reference),
          ...stamp,
        },
      });
      break;
    }
    case 'client': {
      const data = {
        clientName: text(v.clientName),
        clientContactName: text(v.clientContactName),
        clientContactEmail: text(v.clientContactEmail),
        clientContactPhone: text(v.clientContactPhone),
        ...stamp,
      };
      await prisma.cdmDutyHolders.upsert({
        where: { jobSiteId: siteId },
        update: data,
        create: { jobSiteId: siteId, ...data },
      });
      break;
    }
    case 'duty-holders': {
      const data = {
        principalDesigner: text(v.principalDesigner),
        principalDesignerContact: text(v.principalDesignerContact),
        principalDesignerEmail: text(v.principalDesignerEmail),
        principalDesignerPhone: text(v.principalDesignerPhone),
        principalDesignerAppointedAt: date(v.principalDesignerAppointedAt),
        principalContractor: text(v.principalContractor),
        principalContractorContact: text(v.principalContractorContact),
        principalContractorEmail: text(v.principalContractorEmail),
        principalContractorPhone: text(v.principalContractorPhone),
        principalContractorAppointedAt: date(v.principalContractorAppointedAt),
        ...stamp,
      };
      await prisma.cdmDutyHolders.upsert({
        where: { jobSiteId: siteId },
        update: data,
        create: { jobSiteId: siteId, ...data },
      });
      break;
    }
    case 'people': {
      // Replace the site's named personnel wholesale — the wizard always submits
      // the full list, and a partial merge would silently keep deleted people.
      const rows = Array.isArray(v.people) ? v.people : [];
      const valid = rows
        .map((r, idx) => {
          const row = r as Record<string, unknown>;
          const name = text(row.name);
          const kindRaw = String(row.kind ?? '');
          if (!name) return null;
          if (!(kindRaw in SiteKeyPersonKind)) return null;
          return {
            jobSiteId: siteId,
            kind: kindRaw as SiteKeyPersonKind,
            name,
            phone: text(row.phone),
            location: text(row.location),
            order: idx,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      await prisma.$transaction(async (tx) => {
        await tx.siteKeyPerson.deleteMany({ where: { jobSiteId: siteId } });
        if (valid.length > 0) {
          await tx.siteKeyPerson.createMany({ data: valid });
        }
        // The FIRST first-aider stays mirrored onto JobSite's existing columns,
        // so every worker-facing panel built before SC-019 keeps working with no
        // change. JobSite remains the primary entry; SiteKeyPerson is the list.
        const primaryAider = valid.find(
          (r) => r.kind === SiteKeyPersonKind.FIRST_AIDER,
        );
        if (primaryAider) {
          await tx.jobSite.update({
            where: { id: siteId },
            data: {
              firstAiderName: primaryAider.name,
              firstAiderNumber: primaryAider.phone,
              firstAiderLocation: primaryAider.location,
            },
          });
        }
      });
      break;
    }
    case 'emergency': {
      await prisma.jobSite.update({
        where: { id: siteId },
        data: {
          fireAssemblyPoint: text(v.fireAssemblyPoint),
          nearestHospital: text(v.nearestHospital),
          emergencyNumber: text(v.emergencyNumber),
        },
      });
      await upsertInfo(siteId, viewer, {
        emergencyProcedures: text(v.emergencyProcedures),
        fireArrangements: text(v.fireArrangements),
      });
      break;
    }
    case 'welfare':
      await upsertInfo(siteId, viewer, {
        welfareFacilities: text(v.welfareFacilities),
        workingHours: text(v.workingHours),
      });
      break;
    case 'rules':
      await upsertInfo(siteId, viewer, { siteRules: text(v.siteRules) });
      break;
    case 'hazards':
      await upsertInfo(siteId, viewer, {
        siteHazards: text(v.siteHazards),
        existingSiteRisks: text(v.existingSiteRisks),
      });
      break;
    /*
     * THE GATED STEPS SAVE THE ANSWER AND THE DETAIL.
     *
     * Answering "no" CLEARS the detail: a site that has just said it has no
     * temporary works must not keep a paragraph about temporary works, which would
     * go on producing a scene in the induction contradicting the answer.
     */
    case 'high-risk':
      await upsertInfo(siteId, viewer, {
        hasHighRiskActivities: bool(v.hasHighRiskActivities),
        highRiskActivities:
          v.hasHighRiskActivities === false ? null : text(v.highRiskActivities),
      });
      break;
    case 'temporary-works':
      await upsertInfo(siteId, viewer, {
        hasTemporaryWorks: bool(v.hasTemporaryWorks),
        temporaryWorks: v.hasTemporaryWorks === false ? null : text(v.temporaryWorks),
      });
      break;
    case 'access':
      await upsertInfo(siteId, viewer, {
        accessEgress: text(v.accessEgress),
        deliveryProcedures: text(v.deliveryProcedures),
      });
      break;
    case 'traffic':
      await upsertInfo(siteId, viewer, {
        hasTrafficManagement: bool(v.hasTrafficManagement),
        trafficManagement:
          v.hasTrafficManagement === false ? null : text(v.trafficManagement),
      });
      break;
    /*
     * The rules, the PPE and the register save themselves through their own
     * endpoints, so these steps persist only what the wizard itself owns.
     */
    case 'induction':
      await prisma.jobSite.update({
        where: { id: siteId },
        data: { inductionContent: text(v.inductionContent) ?? '' },
      });
      break;
    case 'risks':
    case 'company-content':
      // Nothing of their own: "Save & continue" records that the manager has been
      // through the step, which is what the reviewed list is for.
      break;
    case 'utilities':
      await upsertInfo(siteId, viewer, {
        utilitiesIsolation: text(v.utilitiesIsolation),
      });
      break;
    case 'environment':
      await upsertInfo(siteId, viewer, {
        environmentalControls: text(v.environmentalControls),
      });
      break;
    case 'drawings':
      // Drawings and plans are Document records (reusing the register, its
      // permissions and SC-017 annotation), so this step only records progress.
      break;
    case 'services':
      // SC-021. Each toggle writes immediately through
      // /api/platform/sites/[id]/services, where the availability rules and the
      // active-schedule conflict check live. Routing them through here as well
      // would mean two write paths for one setting and two places for the
      // conflict rule to be enforced — so this step records progress only.
      break;
    default:
      return { ok: false, reason: 'invalid', error: 'Unknown setup step.' };
  }

  await recordProgress(siteId, viewer, input.stepKey, input.markReviewed);
  return { ok: true };
}

/** Write narrative fields onto the EXISTING SC-008 SiteInformation record. */
async function upsertInfo(
  siteId: string,
  viewer: PlatformViewer,
  /*
   * Booleans as well as text now: the three site-condition answers live here.
   * `undefined` is passed through to Prisma as "leave it alone", which is what an
   * unanswered question must do - writing null would turn silence into a decision.
   */
  data: Record<string, string | boolean | null | undefined>,
): Promise<void> {
  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };
  await prisma.siteInformation.upsert({
    where: { jobSiteId: siteId },
    update: { ...data, ...stamp },
    create: { jobSiteId: siteId, ...data, ...stamp },
  });
}

async function recordProgress(
  siteId: string,
  viewer: PlatformViewer,
  stepKey: string,
  markReviewed: boolean,
): Promise<void> {
  const existing = await prisma.siteSetupProgress.findUnique({
    where: { jobSiteId: siteId },
    select: { completedSteps: true },
  });
  const done = new Set(existing?.completedSteps ?? []);
  if (markReviewed) done.add(stepKey);
  else done.delete(stepKey);

  const data = {
    completedSteps: [...done],
    lastStepKey: stepKey,
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };
  await prisma.siteSetupProgress.upsert({
    where: { jobSiteId: siteId },
    update: data,
    create: { jobSiteId: siteId, ...data },
  });
}
