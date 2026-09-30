import {
  issueRevision,
  saveDraft,
  seedModuleCatalogue,
  setModuleActive,
  startDraft,
  updateModuleSettings,
} from '@/services/inductionModules/inductionModuleService';
import type { ModuleActor } from '@/services/inductionModules/moduleActor';

/**
 * THE ONE SET OF COMPANY-MODULE ACTIONS, shared by both front doors.
 *
 * Induction Videos and the Admin Centre administer the same modules. They differ
 * only in how the person signed in and therefore how their authority is
 * resolved; what the actions ARE, and every rule about them, is identical.
 *
 * So the dispatch lives here rather than in either route. Each route does exactly
 * two things: authenticate in its own realm, and build a `ModuleActor`. Neither
 * knows what "issue a revision" means.
 *
 * This is the difference between two front doors and two systems. The Admin
 * Centre → Settings → Company incident is the cautionary case: two surfaces wrote
 * one singleton row under different permissions, with no shared rule layer, and
 * neither screen showed what the other had done. Here there is one service, one
 * approval workflow, one audit trail, and one dispatcher — the realm is recorded
 * on the record, not branched on in the logic.
 */

export interface ActionOutcome {
  status: number;
  payload: Record<string, unknown>;
}

const refuse = (error: string): ActionOutcome => ({
  status: 400,
  payload: { ok: false, error },
});
const ok = (extra: Record<string, unknown> = {}): ActionOutcome => ({
  status: 200,
  payload: { ok: true, ...extra },
});

export async function handleModuleAction(
  actor: ModuleActor,
  body: Record<string, unknown>,
): Promise<ActionOutcome> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

  switch (body.action) {
    case 'startDraft': {
      const r = await startDraft(actor, str('moduleId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'saveDraft': {
      const r = await saveDraft(actor, str('revisionId'), {
        heading: str('heading'),
        narration: str('narration'),
      });
      return r.ok ? ok() : refuse(r.error);
    }
    case 'issue': {
      const r = await issueRevision(actor, str('revisionId'), str('issueNote'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'setActive': {
      const r = await setModuleActive(actor, str('moduleId'), body.active === true);
      return r.ok ? ok() : refuse(r.error);
    }
    case 'settings': {
      const num = (k: string) =>
        typeof body[k] === 'number' ? (body[k] as number) : undefined;
      const bool = (k: string) =>
        typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined;
      const r = await updateModuleSettings(actor, str('moduleId'), {
        mandatory: bool('mandatory'),
        defaultIncluded: bool('defaultIncluded'),
        order: num('order'),
      });
      return r.ok ? ok() : refuse(r.error);
    }
    case 'seed': {
      /*
       * Creating the starter set writes only DRAFTS, but it decides which topics
       * this company briefs on at all - organisational policy rather than a
       * convenience - so it takes the same authority as issuing.
       */
      if (!actor.canIssue) {
        return refuse('You do not have permission to create the starter modules.');
      }
      const result = await seedModuleCatalogue(actor);
      return ok(result as unknown as Record<string, unknown>);
    }
    /*
     * ADD ONE CATALOGUE MODULE ON REQUEST. Seeding creates the STANDARD set; this is
     * how the optional tier (manual handling) and any retired standard module come
     * into being, because nothing else in the product creates a module at all.
     */
    case 'addCatalogueModule': {
      const { addCatalogueModule } = await import(
        '@/services/inductionModules/inductionModuleService'
      );
      const r = await addCatalogueModule(actor, str('slug'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * DISCARD ONE DRAFT — the routine undo. Draft-only and `canDraft`, so it needs
     * neither the build-phase flag nor a Director: a draft has reached nobody. Every
     * condition lives in the service.
     */
    case 'discardDraft': {
      const { discardModuleDraft } = await import(
        '@/services/inductionModules/inductionModuleService'
      );
      const r = await discardModuleDraft(actor, str('moduleId'), str('revisionId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * ── THE THREE VIDEO ACTIONS, ORCHESTRATED SO THE USER SEES ONE ─────────
     *
     * Each one composes several existing services and calls every one of them with
     * the real actor, so no authority check is skipped — only unattended. The user's
     * intention is a single step; the pipeline underneath is unchanged.
     */
    case 'generateNarration': {
      const { ensureGeneratedAssetForModule, startCompanyVideo } = await import(
        '@/services/inductionVideo/companyVideoService'
      );
      const { videoActorFromModuleActor } = await import(
        '@/services/inductionVideo/videoActor'
      );
      const { approveScript } = await import(
        '@/services/inductionVideo/inductionVideoService'
      );
      const { requestNarration } = await import('@/services/inductionVideo/narrationService');
      const { prisma } = await import('@/lib/prisma');

      const moduleId = str('moduleId');
      // 1. The asset, provisioned if this is the first time. Bookkeeping, not a step.
      const asset = await ensureGeneratedAssetForModule(actor, moduleId);
      if (!asset.ok) return refuse(asset.error);

      const vActor = videoActorFromModuleActor(actor);

      /*
       * 2. RESUME rather than start a second. A production already exists when
       * narration failed and put it back to SCRIPT_APPROVED, when one was started
       * under the old multi-page flow, or when the wording moved on and this is a
       * re-generate. startCompanyVideo refuses a second in-flight production, so
       * asking for one here would turn "try again" into a dead end.
       */
      const existing = await prisma.inductionVideo.findFirst({
        where: { libraryAssetId: asset.assetId, publishedAt: null, supersededAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, status: true },
      });
      let videoId = existing?.id ?? '';
      if (!videoId) {
        const started = await startCompanyVideo(vActor, asset.assetId);
        if (!started.ok) return refuse(started.error);
        videoId = started.value.videoId;
      }

      /*
       * 3. Approve, when it still needs it. The script is the Director's own issued
       * wording split into sentences — they approved those words one step ago, so a
       * second approval screen decides nothing. See moduleVideoStage.ts.
       */
      const fresh = await prisma.inductionVideo.findUnique({
        where: { id: videoId },
        select: { status: true },
      });
      if (fresh?.status === 'SCRIPT_READY') {
        const approved = await approveScript(vActor, videoId);
        if (!approved.ok) return refuse(approved.error);
      }

      // 4. Queue the narration. The kicker starts it without waiting for the tick.
      const queued = await requestNarration(vActor, videoId);
      if (!queued.ok) return refuse(queued.error);
      return ok({ videoId, scenes: queued.value.scenes });
    }
    case 'generateVideo': {
      const { requestRender } = await import('@/services/inductionVideo/renderService');
      const { videoActorFromModuleActor } = await import(
        '@/services/inductionVideo/videoActor'
      );
      const r = await requestRender(videoActorFromModuleActor(actor), str('videoId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * PUBLISH AND ISSUE AS ONE ACT. They were two, and a user read them as one: the
     * production was "published to operatives" (it was not — it filed a DRAFT library
     * revision) and then had to be issued from a different page, which nothing said.
     * The issue NOTE is still captured, because it is the audit record of why this
     * version went live and generating one would be inventing the record.
     */
    case 'publishAndIssue': {
      const { publishCompanyVideoToLibrary } = await import(
        '@/services/inductionVideo/companyVideoService'
      );
      const { videoActorFromModuleActor } = await import(
        '@/services/inductionVideo/videoActor'
      );
      const { issueRevision } = await import('@/services/inductionVideo/libraryAssetService');

      const note = str('issueNote').trim();
      if (note.length < 5) return refuse('Say what this version of the video says.');

      const published = await publishCompanyVideoToLibrary(
        videoActorFromModuleActor(actor),
        str('videoId'),
      );
      if (!published.ok) return refuse(published.error);

      /*
       * The revision is filed as a DRAFT by design, then issued here. If issuing
       * fails the production IS published and the draft exists, so the module page's
       * stage lands on Preview with the draft waiting — recoverable by pressing the
       * same button again rather than stuck.
       */
      const issued = await issueRevision(actor, published.value.revisionId, note);
      if (!issued.ok) return refuse(issued.error);
      return ok({ version: issued.value.version, live: true });
    }
    /*
     * START AGAIN — the primary way to clear a module's content: the revisions and
     * everything generated from them go, the subject and its settings stay. Listed
     * before deleteModule deliberately, because deleting a permanent company
     * subject in order to rewrite its wording is the workflow this replaces.
     */
    case 'resetModule': {
      const { resetModule } = await import(
        '@/services/inductionModules/inductionModuleService'
      );
      const r = await resetModule(actor, str('moduleId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    /*
     * DELETE A MODULE OUTRIGHT — only when the SUBJECT itself is unwanted, and
     * refused on an active standard subject. Every condition lives in
     * `deleteModule` / `moduleDeletion`, including the Director check, so there is
     * nothing to repeat here: the id names the thing being deleted rather than a
     * second object reached through it, so there is no ownership to verify first.
     */
    case 'deleteModule': {
      const { deleteModule } = await import(
        '@/services/inductionModules/inductionModuleService'
      );
      const r = await deleteModule(actor, str('moduleId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    default:
      return refuse('Unknown action.');
  }
}
