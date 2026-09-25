import { LibraryPlacement } from '@prisma/client';
import {
  attachUpload,
  createLibraryAsset,
  issueRevision,
  setLibraryAssetActive,
  startRevision,
  updateLibraryAssetSettings,
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
    case 'settings': {
      const r = await updateLibraryAssetSettings(actor, str('assetId'), {
        ...(body.title === undefined ? {} : { title: str('title') }),
        ...(body.description === undefined ? {} : { description: str('description') }),
        ...(body.placement === undefined ? {} : { placement: placement(body.placement) }),
        ...(body.order === undefined ? {} : { order: num('order') }),
        ...(body.moduleId === undefined ? {} : { moduleId: str('moduleId') || null }),
        ...(bool('mandatory') === undefined ? {} : { mandatory: bool('mandatory') }),
        ...(bool('defaultIncluded') === undefined
          ? {}
          : { defaultIncluded: bool('defaultIncluded') }),
      });
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    default:
      return refuse('Unknown action.');
  }
}
