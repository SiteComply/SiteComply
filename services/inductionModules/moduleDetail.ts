import { prisma } from '@/lib/prisma';
import {
  BUILD_PHASE_NOTICE,
  contentResetEnabled,
} from '@/services/inductionContent/buildPhase';
import {
  getModule,
  moduleDeletion,
  moduleReset,
  type ModuleDeletion,
  type ModuleReset,
} from '@/services/inductionModules/inductionModuleService';
import { moduleUsage, type ModuleUsage } from '@/services/inductionModules/moduleUsage';
import { moduleStatus, type ModuleStatus } from '@/services/inductionModules/moduleStatus';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';

/**
 * EVERYTHING ONE COMPANY MODULE'S PAGE NEEDS, assembled once for both tiers.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * There was no route for a single module. Every module's wording, its edit form and
 * its issue form were rendered inline on the landing page, all at once, so the page
 * grew with the catalogue and nothing could be linked to, bookmarked or sent to a
 * colleague. This is the shape of the page that takes that weight.
 *
 * The same arrangement as `libraryDetail` next door, deliberately: one loader per
 * tier-shared detail page, the derived status from its own module, the usage from
 * its own module, and the consequence of an action composed here rather than in the
 * screen - so the Platform and the Admin Centre cannot describe the same module
 * differently.
 */

export interface DetailRevision {
  id: string;
  version: number;
  status: string;
  heading: string;
  narration: string;
  preparedByName: string;
  preparedByRealm: string | null;
  preparedOn: string;
  issuedByName: string | null;
  issuedByRealm: string | null;
  issuedOn: string | null;
  issueNote: string | null;
  supersededOn: string | null;
  /** Newest first, as the history reads. */
  events: {
    id: string;
    action: string;
    actorName: string;
    actorRealm: string | null;
    detail: string | null;
    at: string;
  }[];
}

export interface ModuleDetail {
  id: string;
  slug: string;
  title: string;
  category: string;
  order: number;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  replacesSceneType: string | null;
  status: ModuleStatus;
  usage: ModuleUsage;
  /**
   * The wording in force, or the draft's when nothing is issued, so the page always
   * shows what the module SAYS rather than an empty panel.
   */
  inForce: { heading: string; narration: string; version: number; isDraft: boolean } | null;
  /** The open draft, if there is one. */
  draftId: string | null;
  revisions: DetailRevision[];
  /** Said before the button is pressed. */
  issueConsequence: string | null;
  retireConsequence: string;
  /** A library video that plays instead of this wording. */
  standsInFor: { assetId: string; title: string; hasIssuedRevision: boolean } | null;
  /**
   * Whether this module can be deleted outright, and what would go with it.
   *
   * The page asks the same function the service enforces, so a delete control is
   * never offered for something that would then be refused.
   */
  deletion: ModuleDeletion;
  /**
   * Whether the module's CONTENT can be cleared while the subject stays. The
   * primary restart, and the one the page leads with.
   */
  reset: ModuleReset;
  /**
   * The open draft, if there is one, and what discarding it would mean. Separate
   * from `reset` because this is the ROUTINE undo — a draft has reached nobody, so
   * it needs no flag, no Director and no evidence check.
   */
  draftDiscard: {
    revisionId: string;
    version: number;
    /** True when no issued revision sits behind it, so the module goes blank. */
    leavesNothingWritten: boolean;
  } | null;
  /**
   * The build-phase sentence, or null when the platform is running the strict
   * lifecycle. Carried on the detail rather than passed down from each page so the
   * two tiers cannot describe the capability differently — and so no page has to be
   * edited to add it.
   */
  buildPhaseNotice: string | null;
}

/**
 * What issuing this draft will do, in terms of who hears it.
 *
 * Composed here rather than in the component for the same reason the Library does
 * it: a consequence sentence that lives in a screen gets a second, different
 * wording the first time the other tier needs one.
 */
function describeIssueConsequence(usage: ModuleUsage, version: number): string {
  if (usage.onProjects === 0) {
    return (
      `Issuing revision ${version} puts it in force. No active project includes this ` +
      'module as things stand, so nobody hears it until one does.'
    );
  }
  const where =
    usage.onProjects === usage.totalProjects
      ? `all ${usage.totalProjects} active projects`
      : `${usage.onProjects} of ${usage.totalProjects} active projects`;
  return (
    `Issuing revision ${version} makes it what operatives are told on ${where}. ` +
    'Inductions already published keep the wording they were approved with; new ones ' +
    'take this.'
  );
}

function describeRetireConsequence(usage: ModuleUsage): string {
  if (usage.onProjects === 0) {
    return 'Retiring it changes nothing anybody hears — no active project includes it.';
  }
  return (
    `Retiring it removes this subject from ${usage.onProjects} active ` +
    `${usage.onProjects === 1 ? 'project' : 'projects'}. Published inductions are ` +
    'unchanged; the next generation leaves it out.'
  );
}

export async function moduleDetail(moduleId: string): Promise<ModuleDetail | null> {
  // `row`, not `module`: Next forbids assigning to the `module` identifier.
  const row = await getModule(moduleId);
  if (!row) return null;

  const [usage, deletion, reset, asset] = await Promise.all([
    moduleUsage(moduleId),
    // Deliberately alongside usage rather than inside it: usage answers "who hears
    // this", deletion answers "may this go", and conflating them would make one
    // cache invalidate the other.
    moduleDeletion(moduleId),
    moduleReset(moduleId),
    prisma.libraryAsset.findFirst({
      where: { moduleId, active: true },
      select: {
        id: true,
        title: true,
        revisions: {
          where: { status: 'ISSUED', supersededAt: null },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  const issued = row.revisions.find((r) => r.status === 'ISSUED' && !r.supersededAt) ?? null;
  const draft = row.revisions.find((r) => r.status === 'DRAFT') ?? null;
  const inForceRow = issued ?? draft ?? row.revisions[0] ?? null;

  const status = moduleStatus({
    active: row.active,
    issued: issued ? { version: issued.version } : null,
    draft: draft ? { version: draft.version } : null,
  });

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    order: row.order,
    mandatory: row.mandatory,
    defaultIncluded: row.defaultIncluded,
    active: row.active,
    replacesSceneType: row.replacesSceneType,
    status,
    usage,
    inForce: inForceRow
      ? {
          heading: inForceRow.heading,
          narration: inForceRow.narration,
          version: inForceRow.version,
          isDraft: inForceRow.status === 'DRAFT',
        }
      : null,
    draftId: draft?.id ?? null,
    issueConsequence: draft ? describeIssueConsequence(usage, draft.version) : null,
    retireConsequence: describeRetireConsequence(usage),
    standsInFor: asset
      ? {
          assetId: asset.id,
          title: asset.title,
          hasIssuedRevision: asset.revisions.length > 0,
        }
      : null,
    deletion,
    reset,
    /*
     * Composed here rather than in the screen, like every other consequence on this
     * page, so the Platform and the Admin Centre cannot describe it differently.
     */
    draftDiscard: draft
      ? {
          revisionId: draft.id,
          version: draft.version,
          leavesNothingWritten: !issued,
        }
      : null,
    buildPhaseNotice: contentResetEnabled() ? BUILD_PHASE_NOTICE : null,
    revisions: row.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      heading: r.heading,
      narration: r.narration,
      preparedByName: r.preparedByName,
      preparedByRealm: describeRealm(r.preparedByRealm),
      preparedOn: formatDateUK(r.preparedAt),
      issuedByName: r.issuedByName,
      issuedByRealm: describeRealm(r.issuedByRealm),
      issuedOn: r.issuedAt ? formatDateUK(r.issuedAt) : null,
      issueNote: r.issueNote,
      supersededOn: r.supersededAt ? formatDateUK(r.supersededAt) : null,
      events: r.events.map((e) => ({
        id: e.id,
        action: e.action,
        actorName: e.actorName,
        actorRealm: describeRealm(e.actorRealm),
        detail: e.detail,
        at: formatDateTimeUK(e.createdAt),
      })),
    })),
  };
}
