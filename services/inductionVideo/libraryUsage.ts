/**
 * WHERE IS THIS LIBRARY VIDEO ACTUALLY USED?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * It was unanswerable. The Library could tell you a video was issued and nothing
 * else - not which projects include it, not which inductions contain it, and above
 * all not what retiring it would affect. Every fact below was already in the
 * database and nothing read it:
 *
 *   InductionVideoScene.libraryRevisionId  every induction containing a revision
 *   SiteLibraryAsset                       the per-site include/exclude decisions
 *
 * Two DIFFERENT questions, and conflating them is the trap:
 *
 *   WILL IT BE USED   - which projects have it switched on. Changes the moment
 *                       somebody toggles a decision or the asset is retired.
 *   IS IT USED        - which inductions already contain it. Cannot change, because
 *                       a scene carries the segment path frozen onto it; a published
 *                       induction keeps the revision it was rendered with for ever.
 *
 * The second is what makes a retire or re-issue safe to reason about.
 */
import { InductionVideoStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface RevisionUsage {
  revisionId: string;
  version: number;
  /** Inductions an operative can be shown right now. */
  publishedInductions: number;
  /** Inductions built but not yet published. */
  unpublishedInductions: number;
  /** Distinct projects whose inductions contain this revision. */
  projects: number;
}

export interface LibraryAssetUsage {
  /** Projects that will include the asset in their NEXT generation. */
  onProjects: number;
  totalProjects: number;
  /** Projects that have deliberately switched it off, named so it can be checked. */
  switchedOffBy: { siteId: string; siteName: string }[];
  /** Per-revision, newest first. What is already out there and cannot be recalled. */
  revisions: RevisionUsage[];
  /** Inductions containing ANY revision of this asset and already published. */
  publishedTotal: number;
}

/**
 * A retired asset is on nothing, whatever the per-site decisions say. Mandatory
 * assets are on every active project regardless of decisions, because a site may not
 * leave one out.
 */
export async function libraryAssetUsage(assetId: string): Promise<LibraryAssetUsage> {
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    select: {
      active: true,
      mandatory: true,
      defaultIncluded: true,
      revisions: { select: { id: true, version: true }, orderBy: { version: 'desc' } },
    },
  });
  if (!asset) {
    return { onProjects: 0, totalProjects: 0, switchedOffBy: [], revisions: [], publishedTotal: 0 };
  }

  const [activeSites, decisions, sceneRows] = await Promise.all([
    prisma.jobSite.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.siteLibraryAsset.findMany({
      where: { assetId },
      select: { jobSiteId: true, included: true },
    }),
    // One grouped read rather than a query per revision.
    prisma.inductionVideoScene.findMany({
      where: { libraryRevisionId: { in: asset.revisions.map((r) => r.id) } },
      select: {
        libraryRevisionId: true,
        video: { select: { id: true, jobSiteId: true, status: true, publishedAt: true } },
      },
    }),
  ]);

  const decisionFor = new Map(decisions.map((d) => [d.jobSiteId, d.included]));
  const switchedOffBy = asset.active && !asset.mandatory
    ? activeSites.filter((s) => decisionFor.get(s.id) === false)
        .map((s) => ({ siteId: s.id, siteName: s.name }))
    : [];
  const onProjects = !asset.active
    ? 0
    : asset.mandatory
      ? activeSites.length
      : activeSites.filter((s) => decisionFor.get(s.id) ?? asset.defaultIncluded).length;

  // "Published" means an operative can be shown it: the status, or a publish date
  // that a later withdrawal cleared the status of but not the fact.
  const isPublished = (v: { status: InductionVideoStatus; publishedAt: Date | null }) =>
    v.status === InductionVideoStatus.PUBLISHED || v.publishedAt !== null;

  const revisions: RevisionUsage[] = asset.revisions.map((r) => {
    const rows = sceneRows.filter((s) => s.libraryRevisionId === r.id);
    // A version could in principle contain the same revision in two scenes; count
    // inductions and projects, not scenes.
    const videos = new Map(rows.map((s) => [s.video.id, s.video]));
    let published = 0;
    let unpublished = 0;
    for (const v of videos.values()) (isPublished(v) ? published++ : unpublished++);
    return {
      revisionId: r.id,
      version: r.version,
      publishedInductions: published,
      unpublishedInductions: unpublished,
      projects: new Set([...videos.values()].map((v) => v.jobSiteId)).size,
    };
  });

  return {
    onProjects,
    totalProjects: activeSites.length,
    switchedOffBy,
    revisions,
    publishedTotal: revisions.reduce((n, r) => n + r.publishedInductions, 0),
  };
}

/**
 * WHAT WILL HAPPEN IF I DO THIS? Said before the button is pressed, not after.
 *
 * Retiring and re-issuing both look destructive and are not: what is already
 * published keeps what it was rendered with. That is worth stating plainly, because
 * the fear of breaking a published induction is otherwise a reason not to keep
 * company content up to date.
 */
export function describeRetireConsequence(u: LibraryAssetUsage): string {
  const parts: string[] = [];
  if (u.publishedTotal > 0) {
    parts.push(
      `${u.publishedTotal} published induction${u.publishedTotal === 1 ? '' : 's'} already ` +
        `contain${u.publishedTotal === 1 ? 's' : ''} this video and keep it — a published ` +
        'induction is a record and does not change.',
    );
  }
  parts.push(
    u.onProjects > 0
      ? `${u.onProjects} project${u.onProjects === 1 ? '' : 's'} will stop including it from ` +
        'their next generation onwards.'
      : 'No project currently includes it, so nothing changes for anybody.',
  );
  return parts.join(' ');
}

export function describeIssueConsequence(u: LibraryAssetUsage, nextVersion: number): string {
  const live = u.revisions.find((r) => r.publishedInductions > 0);
  const parts: string[] = [];
  if (live) {
    parts.push(
      `Revision ${live.version} stays on the ${live.publishedInductions} published ` +
        `induction${live.publishedInductions === 1 ? '' : 's'} that contain it.`,
    );
  }
  parts.push(
    u.onProjects > 0
      ? `${u.onProjects} project${u.onProjects === 1 ? '' : 's'} will pick up revision ` +
        `${nextVersion} the next time an induction is generated.`
      : `No project currently includes this video, so revision ${nextVersion} reaches nobody ` +
        'until one does.',
  );
  return parts.join(' ');
}

export interface LibraryUsageSummary {
  assetId: string;
  onProjects: number;
  publishedInductions: number;
}

/**
 * Usage for EVERY asset, for the index.
 *
 * Three queries in total rather than three per asset: the detail page can afford to
 * ask about one video, a list of thirty cannot.
 */
export async function libraryUsageSummaries(): Promise<{
  totalProjects: number;
  byAsset: Map<string, LibraryUsageSummary>;
}> {
  const [assets, activeSites, decisions, scenes] = await Promise.all([
    prisma.libraryAsset.findMany({
      select: {
        id: true,
        active: true,
        mandatory: true,
        defaultIncluded: true,
        revisions: { select: { id: true } },
      },
    }),
    prisma.jobSite.count({ where: { status: 'ACTIVE' } }),
    prisma.siteLibraryAsset.findMany({ select: { assetId: true, jobSiteId: true, included: true } }),
    prisma.inductionVideoScene.findMany({
      where: { libraryRevisionId: { not: null } },
      select: {
        libraryRevisionId: true,
        video: { select: { id: true, status: true, publishedAt: true } },
      },
    }),
  ]);

  const offCount = new Map<string, number>();
  for (const d of decisions) {
    if (d.included === false) offCount.set(d.assetId, (offCount.get(d.assetId) ?? 0) + 1);
  }
  const onCount = new Map<string, number>();
  for (const d of decisions) {
    if (d.included === true) onCount.set(d.assetId, (onCount.get(d.assetId) ?? 0) + 1);
  }

  const revisionToAsset = new Map<string, string>();
  for (const a of assets) for (const r of a.revisions) revisionToAsset.set(r.id, a.id);

  // Distinct inductions per asset, published only - the figure that matters when
  // deciding whether something can be changed.
  const publishedVideos = new Map<string, Set<string>>();
  for (const s of scenes) {
    const assetId = s.libraryRevisionId ? revisionToAsset.get(s.libraryRevisionId) : undefined;
    if (!assetId) continue;
    const published =
      s.video.status === InductionVideoStatus.PUBLISHED || s.video.publishedAt !== null;
    if (!published) continue;
    if (!publishedVideos.has(assetId)) publishedVideos.set(assetId, new Set());
    publishedVideos.get(assetId)!.add(s.video.id);
  }

  const byAsset = new Map<string, LibraryUsageSummary>();
  for (const a of assets) {
    const off = offCount.get(a.id) ?? 0;
    const on = onCount.get(a.id) ?? 0;
    // A site with no decision follows the default. Mandatory beats every decision.
    const undecided = Math.max(0, activeSites - off - on);
    const onProjects = !a.active
      ? 0
      : a.mandatory
        ? activeSites
        : on + (a.defaultIncluded ? undecided : 0);
    byAsset.set(a.id, {
      assetId: a.id,
      onProjects,
      publishedInductions: publishedVideos.get(a.id)?.size ?? 0,
    });
  }
  return { totalProjects: activeSites, byAsset };
}
