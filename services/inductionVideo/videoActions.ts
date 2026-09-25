import {
  approveScript,
  deleteVideoVersion,
  editScene,
  getVideo,
  removeScene,
  requestScript,
  supersedeEarlierVersions,
} from '@/services/inductionVideo/inductionVideoService';
import { publishCompanyVideoToLibrary } from '@/services/inductionVideo/companyVideoService';
import { requestNarration } from '@/services/inductionVideo/narrationService';
import {
  publishVideo,
  requestRender,
  withdrawVideo,
} from '@/services/inductionVideo/renderService';
import type { VideoActor } from '@/services/inductionVideo/videoActor';

/**
 * THE ONE SET OF INDUCTION VIDEO ACTIONS, shared by both entry points.
 *
 * The Platform and the Admin Centre are two doors into one system. They differ
 * only in how the person signed in, and therefore how their authority and their
 * site scope are resolved; the workflow itself — generate, edit, approve,
 * narrate, render, publish, withdraw — is identical, and so is the order it must
 * happen in.
 *
 * So the dispatch lives here and each route does exactly two things: authenticate
 * in its own realm, and build a `VideoActor`. Neither route knows what "approve"
 * means, which is what stops the two tiers from drifting into two workflows with
 * subtly different rules about, say, whether a stale render may be published.
 *
 * Every capability is still re-checked inside the service. This dispatcher routes;
 * it does not decide.
 */

export interface VideoActionOutcome {
  status: number;
  payload: Record<string, unknown>;
}

const refuse = (error: string, status = 400): VideoActionOutcome => ({
  status,
  payload: { ok: false, error },
});
const ok = (extra: Record<string, unknown> = {}): VideoActionOutcome => ({
  status: 200,
  payload: { ok: true, ...extra },
});

/** Actions against one existing version. */
export async function handleVideoAction(
  actor: VideoActor,
  videoId: string,
  body: Record<string, unknown>,
): Promise<VideoActionOutcome> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

  switch (body.action) {
    case 'editScene': {
      const r = await editScene(actor, str('sceneId'), str('narration'));
      return r.ok ? ok() : refuse(r.error);
    }
    case 'removeScene': {
      const r = await removeScene(actor, str('sceneId'));
      return r.ok ? ok() : refuse(r.error);
    }
    case 'approve': {
      const r = await approveScript(actor, videoId);
      if (!r.ok) return refuse(r.error);
      /*
       * Approval makes this the current version; the rest become history and are
       * kept, never deleted. Done here rather than inside approveScript because
       * it is a separate fact about the SITE, and both tiers must do it - leaving
       * it in the route was how one entry point could have approved without
       * superseding.
       */
      const detail = await getVideo(actor, videoId);
      if (detail) {
        await supersedeEarlierVersions(detail.video, actor);
      }
      return ok();
    }
    case 'narrate': {
      const r = await requestNarration(actor, videoId);
      return r.ok ? ok() : refuse(r.error);
    }
    case 'render': {
      const r = await requestRender(actor, videoId);
      return r.ok ? ok() : refuse(r.error);
    }
    case 'publish': {
      /*
       * PUBLISHING MEANS A DIFFERENT THING FOR EACH KIND, and the same button does
       * both so a user learns one workflow.
       *
       * A SITE induction is published TO OPERATIVES: from then on it is what people
       * are shown at that project's gate.
       *
       * A COMPANY video is published INTO THE LIBRARY, as a new revision of its
       * asset. It is left as a DRAFT revision on purpose: the Library's own issue
       * step is what decides that every project starts using it, and that step shows
       * who it will reach before anybody presses it. Publishing the production and
       * issuing it to every site are two decisions, and collapsing them would take
       * the second one away.
       */
      const detail = await getVideo(actor, videoId);
      if (detail && detail.video.jobSiteId === null) {
        const r = await publishCompanyVideoToLibrary(actor, videoId);
        return r.ok ? ok(r.value as unknown as Record<string, unknown>) : refuse(r.error);
      }
      const r = await publishVideo(actor, videoId);
      return r.ok ? ok() : refuse(r.error);
    }
    case 'delete': {
      /*
       * Permanent, and guarded entirely in the service: a version that has been
       * published, watched, superseded, approved, or has a job in flight is
       * refused there rather than here, so both tiers get the same answer.
       */
      const r = await deleteVideoVersion(actor, videoId);
      return r.ok ? ok(r.value as unknown as Record<string, unknown>) : refuse(r.error);
    }
    case 'withdraw': {
      const r = await withdrawVideo(actor, videoId, str('reason'));
      return r.ok ? ok() : refuse(r.error);
    }
    default:
      return refuse('Unknown action.');
  }
}

/**
 * Actions against a PROJECT rather than a version — today only generating the
 * next version, which is also how a regeneration is expressed: a new version is
 * requested and the previous one is kept as history.
 */
export async function handleSiteVideoAction(
  actor: VideoActor,
  siteId: string,
  body: Record<string, unknown>,
): Promise<VideoActionOutcome> {
  if (body.action !== 'generate') return refuse('Unknown action.');
  const r = await requestScript(actor, siteId);
  return r.ok ? ok(r.value as unknown as Record<string, unknown>) : refuse(r.error);
}
