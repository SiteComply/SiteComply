/**
 * Everything one library asset's page needs, assembled once for both front doors.
 *
 * The Library was a single flat list and nothing else: a row had to carry the
 * lifecycle, the settings, the revision history and the upload controls, so it
 * carried none of them well and there was nowhere to put usage or a player. This is
 * the shape of the page that replaces that.
 */
import { prisma } from '@/lib/prisma';
import { revisionReadiness } from '@/services/inductionVideo/libraryAssetService';
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
  /** The open draft, if there is one. */
  draftId: string | null;
  /** Siblings in the same band, so the running order is visible from here. */
  band: { id: string; title: string; order: number; active: boolean }[];
}

export async function libraryAssetDetail(assetId: string): Promise<LibraryAssetDetail | null> {
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    include: {
      module: { select: { id: true, title: true } },
      revisions: { orderBy: { version: 'desc' } },
    },
  });
  if (!asset) return null;

  const [usage, band] = await Promise.all([
    libraryAssetUsage(assetId),
    prisma.libraryAsset.findMany({
      where: { placement: asset.placement },
      select: { id: true, title: true, order: true, active: true },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
    }),
  ]);

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
    draftId: draft?.id ?? null,
    band: band.map((b) => ({ id: b.id, title: b.title, order: b.order, active: b.active })),
    revisions: asset.revisions.map((r) => {
      const readiness = revisionReadiness(r);
      return {
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
