import { LibraryCategory, LibraryPlacement } from '@prisma/client';
import {
  attachUpload,
  createLibraryAsset,
  issueRevision,
  setLibraryAssetActive,
  startRevision,
  updateLibraryAssetSettings,
  previewUrlForRevision,
} from '@/services/inductionVideo/libraryAssetService';
import {
  libraryCaptionsPath,
  librarySourcePath,
  mediaUploadUrl,
  mediaStorageConfigured,
} from '@/services/inductionVideo/mediaStorage';
import { prisma } from '@/lib/prisma';
import type { ModuleActor } from '@/services/inductionModules/moduleActor';

/**
 * THE ONE SET OF LIBRARY ACTIONS, shared by both tiers.
 *
 * Same arrangement as company modules and induction videos: each tier's route
 * authenticates and builds an actor, and neither knows what "issue" means. The
 * Library is administered from the Platform and from the Admin Centre, and there
 * is one lifecycle underneath.
 */

export interface LibraryOutcome {
  status: number;
  payload: Record<string, unknown>;
}

const refuse = (error: string): LibraryOutcome => ({ status: 400, payload: { ok: false, error } });
const ok = (extra: Record<string, unknown> = {}): LibraryOutcome => ({
  status: 200,
  payload: { ok: true, ...extra },
});

function placement(v: unknown): LibraryPlacement {
  return v === 'OPENING' || v === 'CLOSING' ? v : LibraryPlacement.COMPANY_BAND;
}

/** Anything unrecognised is OTHER rather than an error: a category is for finding
 *  things, and refusing to save a video over one is not a trade worth making. */
function category(v: unknown): LibraryCategory {
  return typeof v === 'string' && v in LibraryCategory
    ? (v as LibraryCategory)
    : LibraryCategory.OTHER;
}

export async function handleLibraryAction(
  actor: ModuleActor,
  body: Record<string, unknown>,
): Promise<LibraryOutcome> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const num = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : undefined);
  const bool = (k: string) => (typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined);

  switch (body.action) {
    case 'create': {
      const r = await createLibraryAsset(actor, {
        slug: str('slug'),
        title: str('title'),
        description: str('description'),
        placement: placement(body.placement),
        category: category(body.category),
        provenance: body.provenance === 'GENERATED' ? 'GENERATED' : 'UPLOADED',
        moduleId: str('moduleId') || null,
      });
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'startRevision': {
      const r = await startRevision(actor, str('assetId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /**
     * Hand back a URL the browser may PUT one file to, and the path it will land
     * at. Issued only to somebody who may draft, and only for a revision that is
     * still a draft — otherwise this would be a way to overwrite the footage of an
     * issued revision that operatives are already being shown.
     */
    case 'uploadUrl': {
      if (!actor.canDraft) return refuse('Not available.');
      if (!mediaStorageConfigured()) {
        return refuse('Media storage is not configured on this deployment.');
      }
      const rev = await prisma.libraryAssetRevision.findUnique({
        where: { id: str('revisionId') },
        select: { id: true, assetId: true, status: true },
      });
      if (!rev) return refuse('That revision does not exist.');
      if (rev.status !== 'DRAFT') {
        return refuse('An issued revision cannot be changed. Start a new one.');
      }
      const fileName = str('fileName') || 'upload';
      const blobPath =
        body.kind === 'CAPTIONS'
          ? libraryCaptionsPath(rev.assetId, rev.id)
          : librarySourcePath(rev.assetId, rev.id, fileName);
      if (body.kind === 'CAPTIONS' && !/\.vtt$/i.test(fileName)) {
        return refuse('Captions must be a WebVTT (.vtt) file.');
      }
      return ok({ url: await mediaUploadUrl(blobPath), blobPath });
    }
    case 'attach': {
      const kind = body.kind === 'CAPTIONS' ? 'CAPTIONS' : 'VIDEO';
      const r = await attachUpload(
        actor,
        str('revisionId'),
        kind === 'CAPTIONS'
          ? { kind, blobPath: str('blobPath'), fileName: str('fileName') }
          : {
              kind,
              blobPath: str('blobPath'),
              fileName: str('fileName'),
              bytes: num('bytes') ?? 0,
            },
      );
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'issue': {
      const r = await issueRevision(actor, str('revisionId'), str('issueNote'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'setActive': {
      const r = await setLibraryAssetActive(actor, str('assetId'), body.active === true);
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * A URL TO WATCH A REVISION. The Library had no player at all: you could upload
     * a video, prepare it, issue it to every project and never once see it. The link
     * is short-lived and scoped to the one blob, so footage is never a public URL.
     */
    case 'previewUrl': {
      const revisionId = str('revisionId');
      if (!revisionId) return refuse('Which revision?');
      const url = await previewUrlForRevision(actor, revisionId);
      return url.ok ? ok({ url: url.value }) : refuse(url.error);
    }
    /*
     * PRODUCE IT HERE. The generated path starts from the Library asset, because that
     * is where a user is standing when they decide they have no footage. What comes
     * back is a videoId, and the caller sends them to the ordinary induction-video
     * working surface - the same screens, the same review and approval, for a company
     * video as for a site one.
     */
    case 'produce': {
      const assetId = str('assetId');
      if (!assetId) return refuse('Which library video?');
      const { startCompanyVideo } = await import('@/services/inductionVideo/companyVideoService');
      const { videoActorFromModuleActor } = await import('@/services/inductionVideo/videoActor');
      const r = await startCompanyVideo(videoActorFromModuleActor(actor), assetId);
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * DISCARD A PRODUCTION THAT SHOULD NOT BE FINISHED.
     *
     * Needed because "Finish or delete it first" was, until the asset page showed
     * productions, advice with no way to take it: a production re-pointed at another
     * module cannot be finished - its wording is the wrong subject - and nothing
     * linked to it, so it could not be deleted either.
     *
     * THE ASSET IS CHECKED BEFORE THE ACTOR IS TRUSTED WITH THE ID. Without it this
     * endpoint would delete ANY induction video by id, site videos included, for
     * anybody who may administer the Library. The guard inside deleteVideoVersion
     * asks whether the actor may touch that video; it cannot know the caller reached
     * it through a Library asset that has nothing to do with it.
     */
    case 'discardProduction': {
      const assetId = str('assetId');
      const videoId = str('videoId');
      if (!assetId || !videoId) return refuse('Which production?');
      const video = await prisma.inductionVideo.findUnique({
        where: { id: videoId },
        select: { id: true, libraryAssetId: true },
      });
      if (!video || video.libraryAssetId !== assetId) {
        return refuse('That production does not belong to this library video.');
      }
      const { deleteVideoVersion } = await import('@/services/inductionVideo/inductionVideoService');
      const { videoActorFromModuleActor } = await import('@/services/inductionVideo/videoActor');
      const r = await deleteVideoVersion(videoActorFromModuleActor(actor), videoId);
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'settings': {
      const r = await updateLibraryAssetSettings(actor, str('assetId'), {
        ...(body.title === undefined ? {} : { title: str('title') }),
        ...(body.description === undefined ? {} : { description: str('description') }),
        ...(body.placement === undefined ? {} : { placement: placement(body.placement) }),
        ...(body.category === undefined ? {} : { category: category(body.category) }),
        ...(body.order === undefined ? {} : { order: num('order') }),
        ...(body.moduleId === undefined ? {} : { moduleId: str('moduleId') || null }),
        ...(bool('mandatory') === undefined ? {} : { mandatory: bool('mandatory') }),
        ...(bool('defaultIncluded') === undefined
          ? {}
          : { defaultIncluded: bool('defaultIncluded') }),
      });
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * DISCARDING AND STARTING AGAIN. Each one's conditions live in the service, which
     * re-checks the Director role and asks `consumption.ts` about evidence; these
     * cases only carry the ids across. `discardRevision` takes the assetId as well
     * because the service verifies the revision belongs to that asset, for the same
     * reason `discardProduction` does — otherwise the endpoint discards any revision
     * of any asset by id.
     */
    case 'discardRevision': {
      const { discardLibraryRevision } = await import(
        '@/services/inductionVideo/libraryAssetService'
      );
      const r = await discardLibraryRevision(actor, str('assetId'), str('revisionId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'resetAsset': {
      const { resetLibraryAsset } = await import(
        '@/services/inductionVideo/libraryAssetService'
      );
      const r = await resetLibraryAsset(actor, str('assetId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'deleteAsset': {
      const { deleteLibraryAsset } = await import(
        '@/services/inductionVideo/libraryAssetService'
      );
      const r = await deleteLibraryAsset(actor, str('assetId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    default:
      return refuse('Unknown action.');
  }
}
