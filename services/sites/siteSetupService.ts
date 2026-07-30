import { SiteKeyPersonKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import {
  computeCompleteness,
  isSetupStepKey,
  type SetupCompleteness,
  type SetupFlag,
} from '@/services/sites/siteSetupConstants';

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
 * The conditional flags that decide which steps apply. Derived from data the
 * user has already given rather than asked twice: if a site has recorded
 * temporary works, that step is obviously relevant.
 */
export function deriveFlags(
  site: LoadedSite,
): Partial<Record<SetupFlag, boolean>> {
  const info = site.siteInformation;
  const has = (v: string | null | undefined) => Boolean(v && v.trim());
  return {
    cdmNotifiable: site.projectDetails?.cdmNotifiable === true,
    hasTemporaryWorks: has(info?.temporaryWorks),
    hasTrafficManagement: has(info?.trafficManagement),
    hasHighRiskActivities: has(info?.highRiskActivities),
  };
}

export function completenessFor(site: LoadedSite): SetupCompleteness {
  return computeCompleteness(
    deriveFlags(site),
    site.setupProgress?.completedSteps ?? [],
  );
}

/** Project-level steps are Director-only; operational steps follow sites:edit. */
function mayEditStep(viewer: PlatformViewer, stepKey: string): boolean {
  const projectLevel = ['project', 'client', 'duty-holders', 'f10'];
  if (projectLevel.includes(stepKey)) return canEditSite(viewer.role);
  return permits(viewer.role, 'sites', 'edit');
}

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
  /** Whether to mark the step complete (vs just saving progress). */
  markComplete: boolean;
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
    case 'high-risk':
      await upsertInfo(siteId, viewer, {
        highRiskActivities: text(v.highRiskActivities),
      });
      break;
    case 'temporary-works':
      await upsertInfo(siteId, viewer, {
        temporaryWorks: text(v.temporaryWorks),
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
        trafficManagement: text(v.trafficManagement),
      });
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
    default:
      return { ok: false, reason: 'invalid', error: 'Unknown setup step.' };
  }

  await recordProgress(siteId, viewer, input.stepKey, input.markComplete);
  return { ok: true };
}

/** Write narrative fields onto the EXISTING SC-008 SiteInformation record. */
async function upsertInfo(
  siteId: string,
  viewer: PlatformViewer,
  data: Record<string, string | null>,
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
  markComplete: boolean,
): Promise<void> {
  const existing = await prisma.siteSetupProgress.findUnique({
    where: { jobSiteId: siteId },
    select: { completedSteps: true },
  });
  const done = new Set(existing?.completedSteps ?? []);
  if (markComplete) done.add(stepKey);
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
