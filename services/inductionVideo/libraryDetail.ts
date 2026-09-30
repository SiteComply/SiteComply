/**
 * Everything one library asset's page needs, assembled once for both front doors.
 *
 * The Library was a single flat list and nothing else: a row had to carry the
 * lifecycle, the settings, the revision history and the upload controls, so it
 * carried none of them well and there was nowhere to put usage or a player. This is
 * the shape of the page that replaces that.
 */
import { prisma } from '@/lib/prisma';
import {
  revisionReadiness,
  assetDeletion,
  assetReset,
  type AssetDeletion,
  type AssetReset,
} from '@/services/inductionVideo/libraryAssetService';
import {
  BUILD_PHASE_NOTICE,
  contentResetEnabled,
} from '@/services/inductionContent/buildPhase';
import { versionMayBeDeleted } from '@/services/inductionVideo/inductionVideoService';
import {
  libraryAssetUsage,
  describeIssueConsequence,
  describeRetireConsequence,
  type LibraryAssetUsage,
} from '@/services/inductionVideo/libraryUsage';
import { libraryStatus, type LibraryStatus } from '@/services/inductionVideo/libraryStatus';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatRunningTime } from '@/services/inductionVideo/captions';
import { formatDateUK } from '@/lib/datetime';

export interface DetailRevision {
  id: string;
  version: number;
  status: string;
  /** Present once the transcode has produced something playable. */
  playable: boolean;
  durationLabel: string | null;
  sourceFileName: string | null;
  captionsFileName: string | null;
  normaliseError: string | null;
  missing: string[];
  ready: boolean;
  preparedByName: string;
  preparedByRealm: string | null;
  preparedOn: string;
  issuedByName: string | null;
  issuedByRealm: string | null;
  issuedOn: string | null;
  issueNote: string | null;
  supersededOn: string | null;
  /** For a generated revision: which module revision was rendered. */
  sourceModuleRevisionId: string | null;
  usage: { publishedInductions: number; unpublishedInductions: number; projects: number };
  /** Whether `discardLibraryRevision` would remove this revision. */
  discardable: boolean;
  /** Why not, when it would not. Null when discardable. */
  discardBlockedReason: string | null;
}

/**
 * A PRODUCTION UNDER WAY — a company video being made for this asset.
 *
 * ── WHY THIS IS ON THE PAGE AT ALL ────────────────────────────────────────
 *
 * `startCompanyVideo` refuses a second production while an unpublished one exists,
 * and until this was added NOTHING rendered it. The asset page loaded `revisions`
 * only, and the project listings are `where: { jobSiteId }` while a company video's
 * jobSiteId is null — so the single route to a production was the redirect fired
 * once when Produce was pressed. Navigate away and the asset was wedged behind an
 * error naming a version with no link to it, which is what happened to Company
 * Introduction in production on 2026-09-29.
 *
 * Every field below is the answer to a question somebody had to open the database
 * to ask.
 */
export interface DetailProduction {
  id: string;
  version: number;
  /** An InductionVideoStatus. Rendered by the shared badge, never relabelled here. */
  status: string;
  startedOn: string;
  sceneCount: number;
  /** The module the wording actually came from, which is not always the one the
   *  asset points at now. */
  fromModuleId: string | null;
  fromModuleTitle: string | null;
  fromModuleVersion: number | null;
  /**
   * The asset has been re-pointed at a DIFFERENT module since this was produced, so
   * finishing it would publish the wrong subject under this title. This is the state
   * that trapped Company Introduction and it deserves its own name.
   */
  mismatched: boolean;
  /** Same module, but issued again since — the ordinary "out of date". */
  stale: boolean;
  discardable: boolean;
  /** Why it cannot be discarded from here, when it cannot. */
  blockedReason: string | null;
}

export interface LibraryAssetDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  provenance: string;
  placement: string;
  order: number;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  moduleId: string | null;
  moduleTitle: string | null;
  status: LibraryStatus;
  usage: LibraryAssetUsage;
  /** Said before the button is pressed. */
  retireConsequence: string;
  issueConsequence: string | null;
  revisions: DetailRevision[];
  /**
   * Company videos being produced for this asset that have not been published.
   * An ARRAY even though the service permits only one: if data ever holds two, the
   * page must show both rather than hide the second behind the same silence that
   * hid the first.
   */
  productions: DetailProduction[];
  /** The open draft, if there is one. */
  draftId: string | null;
  /** Siblings in the same band, so the running order is visible from here. */
  band: { id: string; title: string; order: number; active: boolean }[];
  /**
   * Whether the whole asset can be deleted or started again, and what would go.
   * The page asks the same function the service enforces.
   */
  deletion: AssetDeletion;
  /**
   * Whether the asset's CONTENT can be cleared while the asset stays. The primary
   * restart, and the one the page leads with — separate from `deletion` because a
   * mandatory video can be started again but not deleted.
   */
  reset: AssetReset;
  /** The build-phase sentence, or null under the strict lifecycle. */
  buildPhaseNotice: string | null;
}

export async function libraryAssetDetail(assetId: string): Promise<LibraryAssetDetail | null> {
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    include: {
      module: {
        select: {
          id: true,
          title: true,
          // The wording in force NOW, so a production built from an earlier
          // revision can be told apart from one built from another module entirely.
          revisions: {
            where: { status: 'ISSUED' },
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true },
          },
        },
      },
      revisions: { orderBy: { version: 'desc' } },
    },
  });
  if (!asset) return null;

  const [usage, band, productionRows] = await Promise.all([
    libraryAssetUsage(assetId),
    prisma.libraryAsset.findMany({
      where: { placement: asset.placement },
      select: { id: true, title: true, order: true, active: true },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
    }),
    /*
     * IN FLIGHT means "not published", the same test startCompanyVideo applies when
     * it refuses a second production. Matching it exactly is the point: a page that
     * showed a narrower set than the refusal uses would still leave somebody staring
     * at an error about a version they cannot see.
     */
    prisma.inductionVideo.findMany({
      where: { libraryAssetId: assetId, status: { not: 'PUBLISHED' } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        supersededAt: true,
        sourceModuleRevisionId: true,
        _count: { select: { scenes: true, views: true } },
        jobs: { select: { status: true } },
      },
    }),
  ]);

  // The module each production's wording actually came from, resolved in one query.
  const sourceRevisionIds = productionRows
    .map((p) => p.sourceModuleRevisionId)
    .filter((id): id is string => Boolean(id));
  const sourceRevisions = sourceRevisionIds.length
    ? await prisma.inductionModuleRevision.findMany({
        where: { id: { in: sourceRevisionIds } },
        select: { id: true, version: true, moduleId: true, module: { select: { title: true } } },
      })
    : [];
  const sourceById = new Map(sourceRevisions.map((r) => [r.id, r]));
  const currentIssuedRevisionId = asset.module?.revisions[0]?.id ?? null;

  const productions: DetailProduction[] = productionRows.map((p) => {
    const source = p.sourceModuleRevisionId ? sourceById.get(p.sourceModuleRevisionId) : undefined;
    const busyJob = p.jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
    /*
     * THE SAME PREDICATE THE SERVICE ENFORCES, asked here so the page never offers a
     * Discard that deleteVideoVersion would refuse - and never withholds one it
     * would allow. The job check is separate because the predicate takes no jobs: a
     * job row is this version's lock.
     */
    const deletable =
      versionMayBeDeleted({
        status: p.status,
        publishedAt: p.publishedAt,
        supersededAt: p.supersededAt,
        viewCount: p._count.views,
      }) && !busyJob;

    let blockedReason: string | null = null;
    if (!deletable) {
      if (busyJob) blockedReason = 'Something is still running on it. It can be discarded once that finishes.';
      else if (p._count.views > 0) blockedReason = 'Somebody has watched it, so it is the record of their induction.';
      else if (p.supersededAt) blockedReason = 'It has been superseded and is kept as history.';
      else if (p.publishedAt) blockedReason = 'It has been published to operatives.';
      else blockedReason = 'It has been approved, so it is part of the approval workflow. Produce a new version instead.';
    }

    return {
      id: p.id,
      version: p.version,
      status: p.status,
      startedOn: formatDateUK(p.createdAt),
      sceneCount: p._count.scenes,
      fromModuleId: source?.moduleId ?? null,
      fromModuleTitle: source?.module.title ?? null,
      fromModuleVersion: source?.version ?? null,
      // Only a mismatch when BOTH are known: an asset with no module chosen, or a
      // production with no recorded source, is an unknown rather than a conflict.
      mismatched: Boolean(
        source && asset.moduleId && source.moduleId !== asset.moduleId,
      ),
      stale: Boolean(
        source &&
          asset.moduleId &&
          source.moduleId === asset.moduleId &&
          currentIssuedRevisionId &&
          currentIssuedRevisionId !== p.sourceModuleRevisionId,
      ),
      discardable: deletable,
      blockedReason,
    };
  });

  const issued = asset.revisions.find((r) => r.status === 'ISSUED' && !r.supersededAt) ?? null;
  const draft = asset.revisions.find((r) => r.status === 'DRAFT') ?? null;

  const status = libraryStatus({
    active: asset.active,
    issued: issued ? { version: issued.version } : null,
    draft: draft
      ? {
          version: draft.version,
          hasFootage: Boolean(draft.sourceBlobPath),
          normalised: Boolean(draft.normalisedBlobPath),
          hasCaptions: Boolean(draft.captionsBlobPath),
          normaliseError: draft.normaliseError,
        }
      : null,
  });

  const [deletion, reset] = await Promise.all([
    assetDeletion(asset.id),
    assetReset(asset.id),
  ]);

  const usageFor = (revisionId: string) =>
    usage.revisions.find((r) => r.revisionId === revisionId) ?? {
      publishedInductions: 0,
      unpublishedInductions: 0,
      projects: 0,
    };

  return {
    id: asset.id,
    slug: asset.slug,
    title: asset.title,
    description: asset.description,
    category: asset.category,
    provenance: asset.provenance,
    placement: asset.placement,
    order: asset.order,
    mandatory: asset.mandatory,
    defaultIncluded: asset.defaultIncluded,
    active: asset.active,
    moduleId: asset.module?.id ?? null,
    moduleTitle: asset.module?.title ?? null,
    status,
    usage,
    retireConsequence: describeRetireConsequence(usage),
    issueConsequence: draft ? describeIssueConsequence(usage, draft.version) : null,
    productions,
    draftId: draft?.id ?? null,
    band: band.map((b) => ({ id: b.id, title: b.title, order: b.order, active: b.active })),
    deletion,
    reset,
    buildPhaseNotice: contentResetEnabled() ? BUILD_PHASE_NOTICE : null,
    revisions: asset.revisions.map((r) => {
      const readiness = revisionReadiness(r);
      /*
       * A DRAFT IS ALWAYS DISCARDABLE — it reaches nobody by definition, the same
       * rule a construction phase plan's draft follows. Anything issued or
       * superseded is version history: discardable only while build-phase reset is
       * on, and only when no induction carrying this asset was published or
       * watched. `deletion.consumed` is the evidence fact on its own, which is why
       * it is exposed separately from `deletion.deletable`.
       */
      const isDraft = r.status === 'DRAFT';
      const discardable = isDraft || (contentResetEnabled() && !deletion.consumed);
      return {
        discardable,
        discardBlockedReason: discardable
          ? null
          : deletion.consumed
            ? deletion.blockedReason
            : 'Issued footage is kept as version history.',
        id: r.id,
        version: r.version,
        status: r.status,
        playable: Boolean(r.normalisedBlobPath ?? r.sourceBlobPath),
        durationLabel: r.durationMs ? formatRunningTime(r.durationMs) : null,
        sourceFileName: r.sourceFileName,
        captionsFileName: r.captionsFileName,
        normaliseError: r.normaliseError,
        missing: readiness.missing,
        ready: readiness.ready,
        preparedByName: r.preparedByName,
        preparedByRealm: describeRealm(r.preparedByRealm),
        preparedOn: formatDateUK(r.preparedAt),
        issuedByName: r.issuedByName,
        issuedByRealm: describeRealm(r.issuedByRealm),
        issuedOn: r.issuedAt ? formatDateUK(r.issuedAt) : null,
        issueNote: r.issueNote,
        supersededOn: r.supersededAt ? formatDateUK(r.supersededAt) : null,
        sourceModuleRevisionId: r.sourceModuleRevisionId,
        usage: usageFor(r.id),
      };
    }),
  };
}
