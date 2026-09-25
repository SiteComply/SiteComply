import { createHash } from 'crypto';
import {
  LibraryPlacement,
  LibraryRevisionStatus,
  InductionVideoJobStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { kickInductionJobs } from '@/services/inductionVideo/jobKicker';
import { deleteMedia, mediaProperties } from '@/services/inductionVideo/mediaStorage';
import {
  MAX_LIBRARY_VIDEO_BYTES,
  MAX_LIBRARY_VIDEO_MS,
  describeBytes,
} from '@/services/inductionVideo/libraryLimits';
import type { ModuleActor } from '@/services/inductionModules/moduleActor';

/**
 * THE VIDEO LIBRARY: reusable footage, centrally managed.
 *
 * ── THE SAME LIFECYCLE AS A COMPANY MODULE, ON PURPOSE ────────────────────
 *
 * DRAFT → ISSUED → SUPERSEDED, nothing overwritten, and a draft reaches nobody.
 * Not because the pattern is convenient but because the question is identical:
 * "what was this operative shown in July?" has to be answerable years later, and
 * a video is no more editable-in-place than a script is.
 *
 * ── WHAT IS DIFFERENT FROM A MODULE ───────────────────────────────────────
 *
 * Three things, and each one follows from footage not being text:
 *
 *  1. A REVISION IS NOT READY WHEN IT IS WRITTEN. An upload has to be transcoded
 *     to the pipeline's exact output spec before it can be concatenated by stream
 *     copy, and that is a queued job. So a revision can be complete, or waiting,
 *     or failed — a state a text module never has.
 *  2. CAPTIONS ARE REQUIRED TO ISSUE. The finished video's subtitles are built
 *     from narration cues, and a library segment has no narration in this system.
 *     Without its own caption file the subtitles would simply stop for its
 *     duration, which is worse than having none at all.
 *  3. A SITE MAY EXCLUDE BUT NOT OVERRIDE. A module's words can be rewritten for
 *     one project; a project cannot re-shoot a film.
 *
 * Authority is the module actor's, unchanged: drafting is a Director's or Site
 * Manager's, issuing a Director's — an Admin Centre OWNER or ADMIN being their
 * equivalent. One vocabulary for all central content.
 */

export type LibraryResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** What a revision needs before it can be issued. */
export interface RevisionReadiness {
  hasFootage: boolean;
  hasCaptions: boolean;
  normalised: boolean;
  failed: boolean;
  ready: boolean;
  missing: string[];
}

export function revisionReadiness(rev: {
  sourceBlobPath: string | null;
  normalisedBlobPath: string | null;
  captionsBlobPath: string | null;
  normaliseError: string | null;
}): RevisionReadiness {
  const hasFootage = Boolean(rev.sourceBlobPath);
  const normalised = Boolean(rev.normalisedBlobPath);
  const hasCaptions = Boolean(rev.captionsBlobPath);
  const failed = Boolean(rev.normaliseError);
  const missing: string[] = [];
  if (!hasFootage) missing.push('a video file');
  else if (failed) missing.push('a video file that could be prepared');
  else if (!normalised) missing.push('the upload to finish being prepared');
  if (!hasCaptions) missing.push('a caption file');
  return {
    hasFootage,
    hasCaptions,
    normalised,
    failed,
    ready: hasFootage && normalised && hasCaptions && !failed,
    missing,
  };
}

export function assetContentHash(
  normalisedBlobPath: string,
  durationMs: number,
  captionsBlobPath: string,
): string {
  return createHash('sha256')
    .update(`${normalisedBlobPath}|${durationMs}|${captionsBlobPath}`)
    .digest('hex')
    .slice(0, 32);
}

async function record(
  revisionId: string,
  action: string,
  actor: { name: string; realm: 'PLATFORM' | 'ADMIN' | null },
  detail?: string,
): Promise<void> {
  await prisma.libraryAssetEvent.create({
    data: { revisionId, action, actorName: actor.name, actorRealm: actor.realm, detail },
  });
}

/* ───────────────────────────── reading ───────────────────────────── */

export interface LibraryAssetSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  placement: LibraryPlacement;
  order: number;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  moduleId: string | null;
  moduleTitle: string | null;
  /** The revision in force. Null means this asset reaches nobody. */
  issued: {
    id: string;
    version: number;
    issuedAt: Date;
    issuedByName: string | null;
    issuedByRealm: string | null;
    durationMs: number | null;
  } | null;
  /** An unissued revision being worked on, if any. */
  draft: {
    id: string;
    version: number;
    preparedByName: string;
    readiness: RevisionReadiness;
    normaliseError: string | null;
  } | null;
  revisionCount: number;
}

export async function listLibraryAssets(): Promise<LibraryAssetSummary[]> {
  const rows = await prisma.libraryAsset.findMany({
    orderBy: [{ active: 'desc' }, { placement: 'asc' }, { order: 'asc' }],
    include: {
      module: { select: { title: true } },
      revisions: { orderBy: { version: 'desc' } },
      _count: { select: { revisions: true } },
    },
  });

  return rows.map((a) => {
    const issued = a.revisions.find((r) => r.status === LibraryRevisionStatus.ISSUED);
    const draft = a.revisions.find((r) => r.status === LibraryRevisionStatus.DRAFT);
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      placement: a.placement,
      order: a.order,
      mandatory: a.mandatory,
      defaultIncluded: a.defaultIncluded,
      active: a.active,
      moduleId: a.moduleId,
      moduleTitle: a.module?.title ?? null,
      issued:
        issued && issued.issuedAt
          ? {
              id: issued.id,
              version: issued.version,
              issuedAt: issued.issuedAt,
              issuedByName: issued.issuedByName,
              issuedByRealm: issued.issuedByRealm,
              durationMs: issued.durationMs,
            }
          : null,
      draft: draft
        ? {
            id: draft.id,
            version: draft.version,
            preparedByName: draft.preparedByName,
            readiness: revisionReadiness(draft),
            normaliseError: draft.normaliseError,
          }
        : null,
      revisionCount: a._count.revisions,
    };
  });
}

export function getLibraryAsset(assetId: string) {
  return prisma.libraryAsset.findUnique({
    where: { id: assetId },
    include: {
      module: { select: { id: true, title: true } },
      revisions: {
        orderBy: { version: 'desc' },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
      },
    },
  });
}

/* ───────────────────────────── authoring ───────────────────────────── */

export async function createLibraryAsset(
  actor: ModuleActor,
  input: {
    slug: string;
    title: string;
    description?: string;
    placement: LibraryPlacement;
    order?: number;
    moduleId?: string | null;
    mandatory?: boolean;
    defaultIncluded?: boolean;
  },
): Promise<LibraryResult<{ assetId: string }>> {
  if (!actor.canDraft) {
    return { ok: false, error: 'Only a Director or Site Manager may add library videos.' };
  }
  const slug = input.slug.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  if (slug.length < 3) return { ok: false, error: 'Give the video a short reference.' };
  if (input.title.trim().length < 3) return { ok: false, error: 'Give the video a title.' };
  if (await prisma.libraryAsset.findUnique({ where: { slug }, select: { id: true } })) {
    return { ok: false, error: 'A library video with that reference already exists.' };
  }
  const asset = await prisma.libraryAsset.create({
    data: {
      slug,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      placement: input.placement,
      order: input.order ?? 0,
      moduleId: input.moduleId || null,
      mandatory: input.mandatory ?? false,
      defaultIncluded: input.defaultIncluded ?? true,
      createdByName: actor.name,
    },
    select: { id: true },
  });
  return { ok: true, value: { assetId: asset.id } };
}

/**
 * Start a new revision, or return the one already open.
 *
 * ONE DRAFT AT A TIME, as with modules: two concurrent drafts would mean two
 * people uploading different next versions with no way to say which is next.
 */
export async function startRevision(
  actor: ModuleActor,
  assetId: string,
): Promise<LibraryResult<{ revisionId: string; version: number }>> {
  if (!actor.canDraft) {
    return { ok: false, error: 'Only a Director or Site Manager may prepare library videos.' };
  }
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    include: { revisions: { orderBy: { version: 'desc' } } },
  });
  if (!asset) return { ok: false, error: 'That library video does not exist.' };

  const open = asset.revisions.find((r) => r.status === LibraryRevisionStatus.DRAFT);
  if (open) return { ok: true, value: { revisionId: open.id, version: open.version } };

  const version = (asset.revisions[0]?.version ?? 0) + 1;
  const rev = await prisma.libraryAssetRevision.create({
    data: {
      assetId,
      version,
      preparedByUserId: actor.userId,
      preparedByAdminId: actor.adminId,
      preparedByName: actor.name,
      preparedByRealm: actor.realm,
    },
    select: { id: true },
  });
  await record(rev.id, 'DRAFTED', actor, `Version ${version}`);
  return { ok: true, value: { revisionId: rev.id, version } };
}

/**
 * Attach an uploaded file to a draft revision and queue the transcode.
 *
 * The bytes never pass through the application: the browser uploads straight to
 * blob storage with a short-lived SAS, and this records where they landed. A
 * hundred-megabyte video through a Next route on a B1 instance is a request that
 * fails for reasons nobody can act on.
 */
export async function attachUpload(
  actor: ModuleActor,
  revisionId: string,
  input:
    | { kind: 'VIDEO'; blobPath: string; fileName: string; bytes: number }
    | { kind: 'CAPTIONS'; blobPath: string; fileName: string },
): Promise<LibraryResult<{ queued: boolean }>> {
  if (!actor.canDraft) return { ok: false, error: 'Not available.' };
  let trueBytes = input.kind === 'VIDEO' ? input.bytes : 0;
  const rev = await prisma.libraryAssetRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      status: true,
      sourceBlobPath: true,
      captionsBlobPath: true,
      normalisedBlobPath: true,
    },
  });
  if (!rev) return { ok: false, error: 'That revision does not exist.' };
  if (rev.status !== LibraryRevisionStatus.DRAFT) {
    return { ok: false, error: 'An issued revision cannot be changed. Start a new one.' };
  }

  if (input.kind === 'CAPTIONS') {
    if (rev.captionsBlobPath && rev.captionsBlobPath !== input.blobPath) {
      await deleteMedia(rev.captionsBlobPath);
    }
    await prisma.libraryAssetRevision.update({
      where: { id: revisionId },
      data: { captionsBlobPath: input.blobPath, captionsFileName: input.fileName },
    });
    await record(revisionId, 'CAPTIONS_ATTACHED', actor, input.fileName);
    return { ok: true, value: { queued: false } };
  }

  /*
   * VERIFY THE UPLOAD AGAINST STORAGE, and take the size from there.
   *
   * `bytes` arrives from the browser, and the browser also chose `blobPath`. A
   * failed or abandoned PUT followed by a successful attach used to record a
   * revision whose footage did not exist, and the operator only found out when the
   * transcode failed an hour later with "could not be read back from storage".
   */
  if (input.kind === 'VIDEO') {
    const props = await mediaProperties(input.blobPath);
    if (!props || props.totalLength === 0) {
      return {
        ok: false,
        error: 'That upload did not arrive completely. Please try uploading the file again.',
      };
    }
    if (props.totalLength > MAX_LIBRARY_VIDEO_BYTES) {
      return {
        ok: false,
        error:
          `That file is ${describeBytes(props.totalLength)}. The limit is ` +
          `${describeBytes(MAX_LIBRARY_VIDEO_BYTES)} — export it at a lower bitrate, ` +
          'or split it into shorter videos.',
      };
    }
    trueBytes = props.totalLength;
  }

  /*
   * A NEW UPLOAD INVALIDATES THE OLD TRANSCODE. Both files go, and the normalised
   * path is cleared, so a revision can never serve footage from a previous upload
   * while claiming to be the new one.
   */
  if (rev.sourceBlobPath && rev.sourceBlobPath !== input.blobPath) {
    await deleteMedia(rev.sourceBlobPath);
  }
  if (rev.normalisedBlobPath) await deleteMedia(rev.normalisedBlobPath);

  await prisma.libraryAssetRevision.update({
    where: { id: revisionId },
    data: {
      sourceBlobPath: input.blobPath,
      sourceFileName: input.fileName,
      // Storage's number, not the browser's.
      sourceBytes: trueBytes,
      normalisedBlobPath: null,
      normalisedBytes: null,
      durationMs: null,
      normaliseError: null,
      contentHash: null,
    },
  });
  await prisma.libraryNormaliseJob.create({
    data: { revisionId, requestedByName: actor.name },
  });
  await record(revisionId, 'FOOTAGE_UPLOADED', actor, input.fileName);
  /*
   * START IT NOW. Not awaited: the transcode must not sit inside the operator's
   * upload request. Without this the job waited for the hourly tick, and the UI
   * said "Preparing the video for the induction pipeline…" for up to an hour.
   */
  kickInductionJobs();
  return { ok: true, value: { queued: true } };
}

/**
 * Issue a revision: this footage is now what every project's induction carries.
 *
 * DIRECTOR-ONLY, and only when the revision is actually usable. Issuing a revision
 * whose transcode has not finished would put a row in force that the renderer
 * cannot concatenate, and the failure would surface as a broken render on a site
 * rather than as a refusal here.
 */
export async function issueRevision(
  actor: ModuleActor,
  revisionId: string,
  issueNote: string,
): Promise<LibraryResult<{ version: number }>> {
  if (!actor.canIssue) {
    return { ok: false, error: 'Only a Director may issue a library video.' };
  }
  const rev = await prisma.libraryAssetRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      assetId: true,
      version: true,
      status: true,
      sourceBlobPath: true,
      normalisedBlobPath: true,
      normalisedBytes: true,
      captionsBlobPath: true,
      durationMs: true,
      normaliseError: true,
    },
  });
  if (!rev) return { ok: false, error: 'That revision does not exist.' };
  if (rev.status !== LibraryRevisionStatus.DRAFT) {
    return { ok: false, error: 'Only a draft can be issued.' };
  }
  if (issueNote.trim().length < 5) {
    return { ok: false, error: 'Say what changed in this revision. It is kept on the history.' };
  }
  const readiness = revisionReadiness(rev);
  if (!readiness.ready) {
    return {
      ok: false,
      error: `This revision still needs ${readiness.missing.join(' and ')}.`,
    };
  }

  await prisma.$transaction([
    prisma.libraryAssetRevision.updateMany({
      where: { assetId: rev.assetId, status: LibraryRevisionStatus.ISSUED },
      data: { status: LibraryRevisionStatus.SUPERSEDED, supersededAt: new Date() },
    }),
    prisma.libraryAssetRevision.update({
      where: { id: revisionId },
      data: {
        status: LibraryRevisionStatus.ISSUED,
        issuedAt: new Date(),
        issuedByUserId: actor.userId,
        issuedByAdminId: actor.adminId,
        issuedByName: actor.name,
        issuedByRealm: actor.realm,
        issueNote: issueNote.trim(),
        contentHash: assetContentHash(
          rev.normalisedBlobPath!,
          rev.durationMs ?? 0,
          rev.captionsBlobPath!,
        ),
      },
    }),
    prisma.libraryAssetEvent.create({
      data: {
        revisionId,
        action: 'ISSUED',
        actorName: actor.name,
        actorRealm: actor.realm,
        detail: issueNote.trim(),
      },
    }),
  ]);
  return { ok: true, value: { version: rev.version } };
}

export async function setLibraryAssetActive(
  actor: ModuleActor,
  assetId: string,
  active: boolean,
): Promise<LibraryResult<{ active: boolean }>> {
  if (!actor.canIssue) return { ok: false, error: 'Only a Director may retire a library video.' };
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    select: { id: true, mandatory: true },
  });
  if (!asset) return { ok: false, error: 'That library video does not exist.' };
  if (asset.mandatory && !active) {
    return {
      ok: false,
      error: 'This video is required on every project. Make it optional before retiring it.',
    };
  }
  await prisma.libraryAsset.update({ where: { id: assetId }, data: { active } });
  return { ok: true, value: { active } };
}

export async function updateLibraryAssetSettings(
  actor: ModuleActor,
  assetId: string,
  input: {
    title?: string;
    description?: string;
    placement?: LibraryPlacement;
    order?: number;
    moduleId?: string | null;
    mandatory?: boolean;
    defaultIncluded?: boolean;
  },
): Promise<LibraryResult<{ saved: true }>> {
  if (!actor.canIssue) {
    return { ok: false, error: 'Only a Director may change a library video’s settings.' };
  }
  await prisma.libraryAsset.update({
    where: { id: assetId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.description === undefined ? {} : { description: input.description.trim() || null }),
      ...(input.placement === undefined ? {} : { placement: input.placement }),
      ...(input.order === undefined ? {} : { order: input.order }),
      ...(input.moduleId === undefined ? {} : { moduleId: input.moduleId || null }),
      ...(input.mandatory === undefined ? {} : { mandatory: input.mandatory }),
      ...(input.defaultIncluded === undefined ? {} : { defaultIncluded: input.defaultIncluded }),
      // Mandatory and "off by default" cannot both be true.
      ...(input.mandatory === true ? { defaultIncluded: true } : {}),
    },
  });
  return { ok: true, value: { saved: true } };
}

/* ─────────────────────── what a site actually gets ─────────────────────── */

export interface ResolvedLibraryAsset {
  assetId: string;
  slug: string;
  title: string;
  placement: LibraryPlacement;
  order: number;
  mandatory: boolean;
  revisionId: string;
  version: number;
  /** The transcoded segment, ready to concatenate. */
  blobPath: string;
  captionsBlobPath: string;
  durationMs: number;
  /** The company module this footage delivers instead of, if any. */
  replacesModuleId: string | null;
}

/**
 * THE LIBRARY FOOTAGE ONE PROJECT'S INDUCTION CARRIES.
 *
 * The resolution rule lives ONLY here — a site row wins, else the asset's default,
 * else it is not included — so the library screen, the project screen and the
 * rendered video cannot disagree. The same arrangement as
 * `resolveModulesForSite`, for the same reason.
 *
 * A revision with no issued version, or one whose transcode never finished, is
 * invisible: it cannot be concatenated, so it must not appear in a manifest that
 * claims it will be.
 */
export async function resolveLibraryForSite(siteId: string): Promise<ResolvedLibraryAsset[]> {
  const [assets, siteRows] = await Promise.all([
    prisma.libraryAsset.findMany({
      where: { active: true },
      orderBy: [{ placement: 'asc' }, { order: 'asc' }],
      include: {
        revisions: {
          where: { status: LibraryRevisionStatus.ISSUED },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.siteLibraryAsset.findMany({ where: { jobSiteId: siteId } }),
  ]);
  const decisions = new Map(siteRows.map((r) => [r.assetId, r]));

  const resolved: ResolvedLibraryAsset[] = [];
  for (const a of assets) {
    const issued = a.revisions[0];
    if (!issued) continue; // a draft never reaches a site
    // Belt and braces: an issued revision should always be normalised, because
    // issuing refuses otherwise. If one ever is not, it must not reach a render.
    if (!issued.normalisedBlobPath || !issued.captionsBlobPath) continue;

    const decision = decisions.get(a.id);
    const excluded = decision ? !decision.included && !a.mandatory : false;
    if (excluded) continue;
    if (!decision && !a.defaultIncluded) continue;

    resolved.push({
      assetId: a.id,
      slug: a.slug,
      title: a.title,
      placement: a.placement,
      order: a.order,
      mandatory: a.mandatory,
      revisionId: issued.id,
      version: issued.version,
      blobPath: issued.normalisedBlobPath,
      captionsBlobPath: issued.captionsBlobPath,
      durationMs: issued.durationMs ?? 0,
      replacesModuleId: a.moduleId,
    });
  }
  return resolved;
}

export interface SiteLibraryDecision {
  assetId: string;
  slug: string;
  title: string;
  description: string | null;
  placement: LibraryPlacement;
  mandatory: boolean;
  issuedVersion: number | null;
  durationMs: number | null;
  /** Null when the project follows the default. */
  included: boolean | null;
  effectivelyIncluded: boolean;
  reason: string | null;
  decidedByName: string | null;
  decidedByRealm: string | null;
  /** The module whose generated scene this footage replaces, if any. */
  replacesModuleTitle: string | null;
}

export async function libraryDecisionsForSite(siteId: string): Promise<SiteLibraryDecision[]> {
  const [assets, rows, resolved] = await Promise.all([
    prisma.libraryAsset.findMany({
      where: { active: true },
      orderBy: [{ placement: 'asc' }, { order: 'asc' }],
      include: {
        module: { select: { title: true } },
        revisions: {
          where: { status: LibraryRevisionStatus.ISSUED },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.siteLibraryAsset.findMany({ where: { jobSiteId: siteId } }),
    resolveLibraryForSite(siteId),
  ]);
  const decisions = new Map(rows.map((r) => [r.assetId, r]));
  const included = new Set(resolved.map((r) => r.assetId));

  return assets.map((a) => {
    const issued = a.revisions[0];
    const row = decisions.get(a.id);
    return {
      assetId: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      placement: a.placement,
      mandatory: a.mandatory,
      issuedVersion: issued?.version ?? null,
      durationMs: issued?.durationMs ?? null,
      included: row ? row.included : null,
      effectivelyIncluded: included.has(a.id),
      reason: row?.reason ?? null,
      decidedByName: row?.decidedByName ?? null,
      decidedByRealm: row?.decidedByRealm ?? null,
      replacesModuleTitle: a.module?.title ?? null,
    };
  });
}

export type SiteLibraryInput =
  | { state: 'DEFAULT' }
  | { state: 'INCLUDED' }
  | { state: 'EXCLUDED'; reason: string };

/**
 * Record what a project has decided about a library video.
 *
 * ── EXCLUDING NEEDS A REASON; THERE IS NO OVERRIDE ────────────────────────
 *
 * A project leaving out company footage is departing from what the company shows
 * every operative, so it says why and who decided — the same rule as a module.
 * What it cannot do is replace the footage: a site cannot re-shoot a film, so
 * there is no per-site wording to record.
 *
 * WRITTEN BY ID, never by the compound key: the closed-project guard resolves the
 * site from the where clause and cannot see through a compound-unique update.
 */
export async function setSiteLibraryDecision(
  actor: ModuleActor,
  siteId: string,
  assetId: string,
  input: SiteLibraryInput,
): Promise<LibraryResult<{ state: string }>> {
  const asset = await prisma.libraryAsset.findUnique({
    where: { id: assetId },
    select: { id: true, title: true, mandatory: true },
  });
  if (!asset) return { ok: false, error: 'That library video does not exist.' };

  if (input.state === 'EXCLUDED' && asset.mandatory) {
    return {
      ok: false,
      error: `“${asset.title}” is required on every project and cannot be left out.`,
    };
  }
  if (input.state === 'EXCLUDED' && input.reason.trim().length < 10) {
    return { ok: false, error: 'Say why this project leaves it out. It is kept on the record.' };
  }

  const existing = await prisma.siteLibraryAsset.findFirst({
    where: { jobSiteId: siteId, assetId },
    select: { id: true },
  });

  if (input.state === 'DEFAULT') {
    if (existing) await prisma.siteLibraryAsset.delete({ where: { id: existing.id } });
    return { ok: true, value: { state: 'DEFAULT' } };
  }

  const data = {
    included: input.state === 'INCLUDED',
    reason: input.state === 'EXCLUDED' ? input.reason.trim() : null,
    decidedByUserId: actor.userId,
    decidedByAdminId: actor.adminId,
    decidedByName: actor.name,
    decidedByRealm: actor.realm,
  };
  if (existing) {
    await prisma.siteLibraryAsset.update({ where: { id: existing.id }, data });
  } else {
    await prisma.siteLibraryAsset.create({ data: { jobSiteId: siteId, assetId, ...data } });
  }
  return { ok: true, value: { state: input.state } };
}

/** The issued revisions currently in force, for staleness comparisons. */
export async function libraryRevisionIdsForSite(siteId: string): Promise<string[]> {
  const resolved = await resolveLibraryForSite(siteId);
  return resolved.map((r) => r.revisionId);
}

/**
 * How long a RUNNING transcode may be silent before another pass may take it.
 *
 * Comfortably longer than the ffmpeg timeout (15 minutes), so a job that is
 * genuinely still encoding is never stolen from itself - only one abandoned by a
 * process that died is reclaimed.
 */
export const NORMALISE_STALE_AFTER_MS = Number(
  process.env.LIBRARY_NORMALISE_STALE_MS ?? 25 * 60 * 1000,
);

/**
 * Give up after this many attempts.
 *
 * Without a cap, a file that kills the process while being encoded would be
 * reclaimed and retried for as long as the platform runs.
 */
export const NORMALISE_MAX_ATTEMPTS = 3;

/**
 * Queued normalise work, for the scheduler - AND jobs abandoned mid-run.
 *
 * Previously this selected QUEUED only, and nothing anywhere reset a RUNNING row.
 * An App Service recycle during a transcode therefore parked that revision
 * forever: invisible to every later pass, `normalisedBlobPath` still null and
 * `normaliseError` still null, so the UI said "waiting for the upload to finish
 * being prepared" with nothing coming. A restart is routine on a B1 and the
 * transcode is the longest-running thing here, so this was a matter of time.
 */
export function queuedNormaliseJobs(limit: number) {
  const staleBefore = new Date(Date.now() - NORMALISE_STALE_AFTER_MS);
  return prisma.libraryNormaliseJob.findMany({
    where: {
      OR: [
        { status: InductionVideoJobStatus.QUEUED },
        { status: InductionVideoJobStatus.RUNNING, startedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/* ─────────────────────── the transcode, as a queued job ─────────────────── */

/**
 * Run queued normalise jobs.
 *
 * ONE AT A TIME BY DEFAULT. A transcode of real footage is the most expensive
 * thing this platform does on a shared instance, and two at once would starve
 * every request the site is serving. The queue is the throttle.
 *
 * A FAILURE IS RECORDED ON THE REVISION, not just the job, because the person who
 * uploaded it is looking at the revision and needs to know why they cannot issue
 * it. The revision stays a draft with its source intact, so they can replace the
 * file rather than start again.
 */
export async function runQueuedNormaliseJobs(limit = 1): Promise<number> {
  const jobs = await queuedNormaliseJobs(limit);
  if (jobs.length === 0) return 0;

  // Imported here rather than at the top: the normaliser spawns ffmpeg, and
  // nothing that merely reads library metadata should pull that in.
  const { normaliseToSpec, normalisingConfigured } = await import(
    '@/services/inductionVideo/libraryNormaliser'
  );
  const { downloadMediaToFile, uploadMediaFromFile, libraryNormalisedPath } = await import(
    '@/services/inductionVideo/mediaStorage'
  );

  let done = 0;
  for (const job of jobs) {
    /*
     * CLAIM IT ATOMICALLY, the way the render drain already does. This was a bare
     * `update`, so two overlapping passes - the upload's own nudge and the hourly
     * tick, a scheduler retry, a past-due catch-up - could both read the same row
     * and both spawn ffmpeg on it: two 1080p encodes on one core.
     *
     * The status AND startedAt must both be unchanged since the read. That covers
     * the reclaimed-stale case too: whoever writes first wins, and the loser sees
     * no rows updated and moves on.
     */
    const claimed = await prisma.libraryNormaliseJob.updateMany({
      where: { id: job.id, status: job.status, startedAt: job.startedAt },
      data: {
        status: InductionVideoJobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue;

    const fail = async (message: string) => {
      await prisma.libraryNormaliseJob.update({
        where: { id: job.id },
        data: { status: InductionVideoJobStatus.FAILED, finishedAt: new Date(), error: message.slice(0, 500) },
      });
      await prisma.libraryAssetRevision.update({
        where: { id: job.revisionId },
        data: { normaliseError: message.slice(0, 500) },
      });
      await record(job.revisionId, 'PREPARE_FAILED', { name: 'SiteComply', realm: null }, message.slice(0, 200));
    };

    /*
     * GIVE UP RATHER THAN LOOP. `attempts` was incremented and never read: a file
     * that takes the process down while encoding would be reclaimed as stale and
     * retried for the life of the platform. The operator gets a reason instead.
     */
    if (job.attempts + 1 > NORMALISE_MAX_ATTEMPTS) {
      await fail(
        `preparing this video failed ${job.attempts} times and will not be retried automatically. ` +
          'Upload the file again, or a different export of it.',
      );
      continue;
    }

    try {
      const rev = await prisma.libraryAssetRevision.findUnique({
        where: { id: job.revisionId },
        select: { id: true, assetId: true, sourceBlobPath: true, sourceFileName: true },
      });
      if (!rev?.sourceBlobPath) {
        await fail('The uploaded file could not be found.');
        continue;
      }
      if (!normalisingConfigured()) {
        await fail('Video preparation is not configured on this deployment.');
        continue;
      }

      /*
       * STREAMED, BOTH WAYS. Storage → a temp file → ffmpeg → a temp file →
       * storage, with no copy of the video in the Node heap. This used to
       * download the whole source into a Buffer and read the whole result into
       * another, which on a 1.75 GB instance is how a long video takes the site
       * down with it rather than just failing.
       */
      const prepared = await normaliseToSpec(
        (destination) => downloadMediaToFile(rev.sourceBlobPath!, destination),
        rev.sourceFileName ?? 'upload.mp4',
        async ({ outputPath, durationMs }) => {
          if (durationMs <= 0) return { ok: false as const, reason: 'The file does not appear to contain any video.' };
          if (durationMs > MAX_LIBRARY_VIDEO_MS) {
            return {
              ok: false as const,
              reason:
                `That video is ${Math.round(durationMs / 60000)} minutes long. The limit is ` +
                `${Math.round(MAX_LIBRARY_VIDEO_MS / 60000)} minutes — an operative at a site ` +
                'gate will not watch longer than that. Split it into shorter videos.',
            };
          }
          const path = libraryNormalisedPath(rev.assetId, rev.id);
          await uploadMediaFromFile(path, outputPath, 'video/mp4');
          const bytes = (await import('node:fs/promises')).stat(outputPath);
          return { ok: true as const, path, durationMs, bytes: (await bytes).size };
        },
      );
      if (!prepared.ok) {
        await fail(prepared.reason);
        continue;
      }

      await prisma.libraryAssetRevision.update({
        where: { id: rev.id },
        data: {
          normalisedBlobPath: prepared.path,
          normalisedBytes: prepared.bytes,
          durationMs: prepared.durationMs,
          normaliseError: null,
        },
      });
      await prisma.libraryNormaliseJob.update({
        where: { id: job.id },
        data: { status: InductionVideoJobStatus.SUCCEEDED, finishedAt: new Date(), error: null },
      });
      await record(
        rev.id,
        'PREPARED',
        { name: 'SiteComply', realm: null },
        `${Math.round(prepared.durationMs / 1000)}s · ${describeBytes(prepared.bytes)}`,
      );
      done++;
    } catch (e) {
      await fail(e instanceof Error ? e.message : 'The file could not be prepared.');
    }
  }
  return done;
}

// Re-exported so server callers and the verification suites have one import.
export { MAX_LIBRARY_VIDEO_BYTES, MAX_LIBRARY_VIDEO_MS, describeBytes };
