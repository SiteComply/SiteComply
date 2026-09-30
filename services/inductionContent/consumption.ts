import { InductionVideoStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * ONE place that answers "has a real person had this?"
 *
 * Every delete and every reset in the induction-video area asks this and nothing
 * else. The reason it is a single module rather than a condition repeated at each
 * call site is that the answer decides whether something is a record or a
 * by-product, and three subtly different versions of that test would eventually
 * disagree — at which point one screen offers a delete that another refuses, or
 * worse, one of them is wrong about evidence.
 *
 * ── THE DEFINITION ────────────────────────────────────────────────────────
 *
 * A video version is CONSUMED when either is true:
 *
 *   PUBLISHED   `status = PUBLISHED` OR `publishedAt` is set. Both, because a
 *               withdrawal clears the status but not the fact that operatives
 *               could see it. This is the same `isPublished` used by
 *               `libraryUsage.ts` and the retention sweep.
 *   WATCHED     one `InductionVideoView` row. One is enough, permanently: it is
 *               the record of somebody's induction.
 *
 * A MODULE or a LIBRARY ASSET is consumed when any video carrying its content is
 * consumed. Content, not configuration: a per-site decision to include a module
 * is a setting somebody can change back, not something an operative saw.
 *
 * ── WHY MODULE CONTENT SURVIVES ITS MODULE BEING DELETED ──────────────────
 *
 * Worth stating because it is counter-intuitive and it is what makes a module
 * delete safe at all. `InductionVideoScene` stores the `narration` and `heading`
 * as its own columns, and holds `moduleRevisionId` as a plain String with no
 * foreign key — deliberately, per
 * `prisma/migrations/20260924180000_add_scene_module_revision/migration.sql`:
 * a cascade there would rewrite the record, and a restrict would block the
 * delete. So a published induction keeps the exact words an operative heard even
 * if the module they came from is gone. What is lost is the ability to look the
 * revision up by id, which is why a consumed module is still refused below —
 * it is just a smaller loss than the schema comment might suggest.
 *
 * ── AND WHY A LIBRARY ASSET DELETE IS THE DANGEROUS ONE ───────────────────
 *
 * `InductionVideo.libraryAsset` is `onDelete: Cascade`, and `InductionVideoView`
 * cascades from the video. So `prisma.libraryAsset.delete()` on an asset with
 * published productions would destroy operative viewing records without error.
 * The database will not stop it. `assetConsumption` is what stops it, and it is
 * the reason the asset delete must never be written as a bare `delete`.
 */

/** Set on a video, or on the videos carrying some content. */
export interface Consumption {
  /** True when a real person has been shown this, or could have been. */
  consumed: boolean;
  /** How many carrying versions were published to operatives. */
  publishedVersions: number;
  /** How many viewing records exist across those versions. */
  viewRows: number;
  /**
   * The sentence to show when `consumed` — already phrased for a manager, and
   * naming which of the two facts applies. Null when not consumed.
   */
  reason: string | null;
}

const NOT_CONSUMED: Consumption = {
  consumed: false,
  publishedVersions: 0,
  viewRows: 0,
  reason: null,
};

/** The shape every consumption query selects, so the rule is applied once. */
interface VideoFacts {
  status: InductionVideoStatus;
  publishedAt: Date | null;
  _count: { views: number };
}

const VIDEO_FACTS = {
  status: true,
  publishedAt: true,
  _count: { select: { views: true } },
} as const;

/**
 * Published means an operative could be shown it: the status, or a publish date
 * that a later withdrawal cleared the status of but not the fact.
 */
function isPublished(v: { status: InductionVideoStatus; publishedAt: Date | null }): boolean {
  return v.status === InductionVideoStatus.PUBLISHED || v.publishedAt !== null;
}

/**
 * Fold a set of carrying versions into one answer.
 *
 * `noun` completes the refusal, e.g. "this module" → "…so this module cannot be
 * deleted." Phrased as a fact about the record rather than a permission error,
 * because no permission would change it.
 */
function summarise(videos: VideoFacts[], noun: string): Consumption {
  const publishedVersions = videos.filter(isPublished).length;
  const viewRows = videos.reduce((n, v) => n + v._count.views, 0);
  if (publishedVersions === 0 && viewRows === 0) return NOT_CONSUMED;

  /*
   * WATCHED IS NAMED FIRST when both are true. A manager deciding whether to
   * insist knows that "published" might mean nobody ever opened it, whereas a
   * viewing record is a named operative's induction. Saying the weaker fact
   * first invites the reply "but nobody watched it" — which may be exactly
   * wrong.
   */
  const reason =
    viewRows > 0
      ? `An operative has watched ${noun}, so it is the record of their induction ` +
        'and is kept permanently.'
      : `${noun[0].toUpperCase()}${noun.slice(1)} has been published to operatives, ` +
        'so it is kept as the record of what they could be shown.';

  return { consumed: true, publishedVersions, viewRows, reason };
}

/** Has this one video version been published or watched? */
export async function videoConsumption(videoId: string): Promise<Consumption> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: VIDEO_FACTS,
  });
  if (!video) return NOT_CONSUMED;
  return summarise([video], 'this version');
}

/**
 * Has any video carrying this module's wording been published or watched?
 *
 * Two carriers, both by denormalised id and neither a relation, so both must be
 * asked explicitly: a SCENE in a site induction (`scene.moduleRevisionId`) and a
 * company video produced from the module (`video.sourceModuleRevisionId`).
 * Missing the second would call a module unconsumed while a published company
 * video was made from it.
 */
export async function moduleConsumption(moduleId: string): Promise<Consumption> {
  const revisions = await prisma.inductionModuleRevision.findMany({
    where: { moduleId },
    select: { id: true },
  });
  if (revisions.length === 0) return NOT_CONSUMED;
  const revisionIds = revisions.map((r) => r.id);

  const [scenes, produced] = await Promise.all([
    prisma.inductionVideoScene.findMany({
      where: { moduleRevisionId: { in: revisionIds } },
      select: { videoId: true, video: { select: VIDEO_FACTS } },
    }),
    prisma.inductionVideo.findMany({
      where: { sourceModuleRevisionId: { in: revisionIds } },
      select: { id: true, ...VIDEO_FACTS },
    }),
  ]);

  /*
   * DISTINCT VERSIONS. A version can carry the same module in more than one
   * scene, and a company production is reachable by both queries at once. Double
   * counting would not change `consumed`, but it would overstate the view count
   * in the sentence a manager reads.
   */
  const byVideo = new Map<string, VideoFacts>();
  for (const s of scenes) byVideo.set(s.videoId, s.video);
  for (const v of produced) byVideo.set(v.id, v);

  return summarise([...byVideo.values()], 'this module');
}

/**
 * Has any video carrying this asset's footage been published or watched?
 *
 * Also two carriers: the asset's own PRODUCTIONS (`InductionVideo.libraryAssetId`
 * — the ones that cascade-delete with the asset, which is the whole risk) and
 * SCENES of site inductions that spliced one of its issued revisions in
 * (`scene.libraryRevisionId`).
 */
export async function assetConsumption(assetId: string): Promise<Consumption> {
  const revisions = await prisma.libraryAssetRevision.findMany({
    where: { assetId },
    select: { id: true },
  });
  const revisionIds = revisions.map((r) => r.id);

  const [productions, scenes] = await Promise.all([
    prisma.inductionVideo.findMany({
      where: { libraryAssetId: assetId },
      select: { id: true, ...VIDEO_FACTS },
    }),
    revisionIds.length === 0
      ? Promise.resolve([])
      : prisma.inductionVideoScene.findMany({
          where: { libraryRevisionId: { in: revisionIds } },
          select: { videoId: true, video: { select: VIDEO_FACTS } },
        }),
  ]);

  const byVideo = new Map<string, VideoFacts>();
  for (const v of productions) byVideo.set(v.id, v);
  for (const s of scenes) byVideo.set(s.videoId, s.video);

  return summarise([...byVideo.values()], 'this library video');
}

/**
 * Is a library revision still serving this video's rendered file?
 *
 * ── A REAL SHARED BLOB, NOT A THEORETICAL ONE ─────────────────────────────
 *
 * `publishCompanyVideoToLibrary` points the new `LibraryAssetRevision`'s
 * `normalisedBlobPath` at the production's own MP4 rather than copying it, so one
 * file is reachable from two lifecycles at once. The video lifecycle believes it
 * owns that path: `renderVideo` deletes the previous MP4 when re-rendering, the
 * retention sweep nulls it on superseded versions, and `deleteVideoVersion`
 * removes it outright. Any of those would pull the file out from under an issued
 * library revision that is still being played to operatives, and nothing in the
 * schema prevents it — the two records are joined by a string, not a key.
 *
 * Asked by the delete paths before they remove a rendered file. Lives here rather
 * than in `libraryAssetService` so the video service can ask it without importing
 * the library service, which reaches `jobKicker` and back again.
 */
export async function blobServedByLibrary(videoBlobPath: string | null): Promise<boolean> {
  if (!videoBlobPath) return false;
  const serving = await prisma.libraryAssetRevision.findFirst({
    where: { normalisedBlobPath: videoBlobPath },
    select: { id: true },
  });
  return serving !== null;
}
