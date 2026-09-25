import {
  InductionVideoStatus,
  InductionVideoJobKind,
  InductionVideoJobStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { VideoActor } from '@/services/inductionVideo/videoActor';
import {
  canApproveInductionVideo,
  canManageInductionVideos,
} from '@/services/inductionVideo/inductionVideoPermissions';
import { manifestForSite, generateScript, loadVideoSource } from '@/services/inductionVideo/scriptService';
import { deleteMedia } from '@/services/inductionVideo/mediaStorage';
import { refuseIfOverBudget } from '@/services/inductionVideo/spendGuard';
import { kickInductionJobs } from '@/services/inductionVideo/jobKicker';
import { buildSceneManifest, manifestHash } from '@/services/inductionVideo/sceneRules';

/**
 * The induction video workflow: versions, approval, publication and the trail.
 *
 * ── VERSIONS ARE KEPT ─────────────────────────────────────────────────────
 *
 * A new version supersedes its predecessor; nothing is overwritten and nothing
 * is deleted. An operative inducted against version 2 must still be able to be
 * shown what version 2 said, which is the whole evidential point - the same
 * reason the construction phase plan freezes its revisions.
 *
 * ── APPROVAL IS A DECISION, NOT A SAVE ────────────────────────────────────
 *
 * Generation produces a draft. A Director or Site Manager approves it, and the
 * approval records who and when. Editing an approved script returns it to
 * review, because the thing that was approved no longer exists.
 *
 * ── THE SITE'S DATA MOVES ON ──────────────────────────────────────────────
 *
 * Each version stores the fingerprint of the facts it was generated from. When
 * the site's data changes, the version is not rewritten: it is reported as
 * stale, and a manager decides whether to generate a new one.
 */

export type VideoResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** What a script has actually cost in production, rounded up. For the cap. */
const SCRIPT_ESTIMATE_PENCE = 3;

/**
 * THE access rule for induction videos: the right role, and this project in the
 * viewer's assigned sites. Exported because Phase 2's media routes need exactly
 * this test - a second, hand-written copy of it in a route file is how a
 * download ends up readable by a manager from another project.
 */
export function canWorkOnVideoSite(viewer: PlatformViewer, siteId: string): boolean {
  return canManageInductionVideos(viewer.role) && viewer.siteIds.includes(siteId);
}

/**
 * May this actor work on this project?
 *
 * Site authority is ASKED rather than enumerated, so a Platform user is tested
 * against their assigned sites and an Admin Centre actor answers for every
 * project. See videoActor.ts for why an empty site list would have been the
 * dangerous way to express that.
 */
function guard(actor: VideoActor, siteId: string): boolean {
  return actor.maySite(siteId);
}

/**
 * A background job has no realm, and saying so is more honest than attributing
 * its work to the Platform. `SYSTEM` is what the queue runners pass.
 */
export const SYSTEM_ACTOR = { name: 'SiteComply', realm: null } as const;

async function record(
  videoId: string,
  action: string,
  actor: { name: string; realm: 'PLATFORM' | 'ADMIN' | null },
  detail?: string,
): Promise<void> {
  await prisma.inductionVideoEvent.create({
    data: {
      videoId,
      action,
      actorName: actor.name,
      // Recorded on every event, so "who approved this" is answerable without
      // knowing which tier was open at the time.
      actorRealm: actor.realm,
      detail,
    },
  });
}

export interface VideoSummary {
  id: string;
  version: number;
  status: InductionVideoStatus;
  siteId: string;
  siteName: string;
  sceneCount: number;
  generatedAt: Date | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  publishedAt: Date | null;
  supersededAt: Date | null;
  /** True when the site's data has changed since this version was generated. */
  stale: boolean;
  /** One view and this version is the record of somebody's induction. */
  viewCount: number;
}

/** Every version for one site, newest first. */
export async function listVideosForSite(
  actor: VideoActor,
  siteId: string,
): Promise<VideoSummary[] | null> {
  if (!guard(actor, siteId)) return null;
  const [site, rows, manifest] = await Promise.all([
    prisma.jobSite.findUnique({ where: { id: siteId }, select: { name: true } }),
    prisma.inductionVideo.findMany({
      where: { jobSiteId: siteId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { scenes: true, views: true } } },
    }),
    manifestForSite(siteId),
  ]);
  if (!site) return null;
  const currentHash = manifest ? manifestHash(manifest) : null;

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    siteId,
    siteName: site.name,
    sceneCount: r._count.scenes,
    viewCount: r._count.views,
    generatedAt: r.generatedAt,
    approvedAt: r.approvedAt,
    approvedByName: r.approvedByName,
    publishedAt: r.publishedAt,
    supersededAt: r.supersededAt,
    stale: Boolean(r.sourceHash && currentHash && r.sourceHash !== currentHash),
  }));
}

/** The readiness check: what the site can say, and what it must fix first. */
export async function readinessForSite(actor: VideoActor, siteId: string) {
  if (!guard(actor, siteId)) return null;
  const src = await loadVideoSource(siteId);
  if (!src) return null;
  const manifest = buildSceneManifest(src);
  return {
    siteName: src.siteName,
    manifest,
    /** Shown in Step 1: what the video would be built from. */
    sourceSummary: {
      risks: src.risks.length,
      siteRules: src.siteRules.length,
      ppe: src.ppe.length,
      rams: src.ramsDocuments.length,
      permits: src.permitTypes.length,
      hasSiteMap: src.info.hasSiteMap,
    },
  };
}

/**
 * Start a generation. Creates the next version and queues the work; the
 * scheduler runs it. Nothing long-running happens in the request.
 */
export async function requestScript(
  actor: VideoActor,
  siteId: string,
): Promise<VideoResult<{ videoId: string; version: number }>> {
  if (!guard(actor, siteId)) return { ok: false, error: 'Not available.' };

  const src = await loadVideoSource(siteId);
  if (!src) return { ok: false, error: 'That project is not available.' };
  const manifest = buildSceneManifest(src);

  const inFlight = await prisma.inductionVideo.findFirst({
    where: { jobSiteId: siteId, status: InductionVideoStatus.SCRIPT_GENERATING },
    select: { id: true },
  });
  if (inFlight) {
    return { ok: false, error: 'A script is already being generated for this project.' };
  }
  /*
   * THE DAILY CEILING IS CHECKED BEFORE ANYTHING IS QUEUED. A script is only a
   * few pence, but the cap protects one bill and every paid step answers to it -
   * otherwise the cheap step becomes the way round the guard.
   */
  const overBudget = await refuseIfOverBudget(SCRIPT_ESTIMATE_PENCE);
  if (overBudget) return { ok: false, error: overBudget };

  /*
   * A BLOCKED ATTEMPT IS NOT A VERSION.
   *
   * A manager whose site is missing its asbestos controls will press Generate,
   * read the message, fix the data and press it again. If each attempt claimed a
   * number, the first real script would be version 4 and the history would count
   * the manager's persistence rather than the site's inductions. The blocked row
   * is reused instead: version numbers count scripts that exist.
   */
  const last = await prisma.inductionVideo.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true },
  });
  const reusable =
    last && last.status === InductionVideoStatus.INFORMATION_REQUIRED ? last : null;
  const version = reusable ? reusable.version : (last?.version ?? 0) + 1;

  /*
   * BLOCKED IS A STATE, NOT AN ERROR. The version is created so the missing
   * facts are recorded against something a manager can open, return to, and see
   * resolved - rather than a toast that disappears.
   */
  if (!manifest.canGenerate) {
    const video = reusable
      ? await prisma.inductionVideo.update({
          where: { id: reusable.id },
          data: {
            blockingReasons: manifest.missing as unknown as object,
            generatedByName: actor.name,
          },
          select: { id: true },
        })
      : await prisma.inductionVideo.create({
          data: {
            jobSiteId: siteId,
            version,
            status: InductionVideoStatus.INFORMATION_REQUIRED,
            blockingReasons: manifest.missing as unknown as object,
            generatedByName: actor.name,
          },
          select: { id: true },
        });
    await record(video.id, 'INFORMATION_REQUIRED', actor,
      manifest.missing.map((m) => m.heading).join(', '));
    return { ok: true, value: { videoId: video.id, version } };
  }

  const video = reusable
    ? await prisma.inductionVideo.update({
        where: { id: reusable.id },
        data: {
          status: InductionVideoStatus.SCRIPT_GENERATING,
          // DbNull, not undefined: undefined means "leave it as it is", which
          // would keep yesterday's missing-information list on a version that
          // now has everything it needs.
          blockingReasons: Prisma.DbNull,
          generatedByName: actor.name,
        },
        select: { id: true },
      })
    : await prisma.inductionVideo.create({
        data: {
          jobSiteId: siteId,
          version,
          status: InductionVideoStatus.SCRIPT_GENERATING,
          generatedByName: actor.name,
        },
        select: { id: true },
      });
  await prisma.inductionVideoJob.create({
    data: {
      videoId: video.id,
      kind: InductionVideoJobKind.SCRIPT,
      requestedByName: actor.name,
    },
  });
  await record(video.id, 'SCRIPT_REQUESTED', actor, `Version ${version}`);
  // Start it NOW rather than at five past the hour; the tick is the safety net.
  kickInductionJobs();
  return { ok: true, value: { videoId: video.id, version } };
}

/**
 * Run one queued script job. Called by the scheduler, never by a request.
 * Returns the number of jobs processed.
 */
export async function runQueuedScriptJobs(limit = 2): Promise<number> {
  const jobs = await prisma.inductionVideoJob.findMany({
    where: { kind: InductionVideoJobKind.SCRIPT, status: InductionVideoJobStatus.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { video: { include: { jobSite: { select: { id: true, name: true } } } } },
  });

  let done = 0;
  for (const job of jobs) {
    // Claim it first: two scheduler ticks must not run the same job.
    const claimed = await prisma.inductionVideoJob.updateMany({
      where: { id: job.id, status: InductionVideoJobStatus.QUEUED },
      data: {
        status: InductionVideoJobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue;

    try {
      const manifest = await manifestForSite(job.video.jobSite.id);
      if (!manifest || !manifest.canGenerate) {
        throw new Error('The project no longer has the information this script needs.');
      }
      const script = await generateScript(manifest, job.video.jobSite.name);

      await prisma.$transaction([
        prisma.inductionVideoScene.deleteMany({ where: { videoId: job.videoId } }),
        prisma.inductionVideoScene.createMany({
          data: script.scenes.map((s, i) => ({
            videoId: job.videoId,
            sceneType: s.sceneType,
            order: i,
            heading: s.heading,
            narration: s.narration,
            visualTemplate: s.visualTemplate,
            sourceRefs: s.sourceRefs as unknown as object,
            required: s.required,
            moduleRevisionId: s.moduleRevisionId,
            libraryRevisionId: s.libraryRevisionId,
            libraryBlobPath: s.libraryBlobPath,
            libraryCaptionsBlobPath: s.libraryCaptionsBlobPath,
            libraryDurationMs: s.libraryDurationMs,
          })),
        }),
        prisma.inductionVideo.update({
          where: { id: job.videoId },
          data: {
            status: InductionVideoStatus.SCRIPT_READY,
            sourceHash: script.sourceHash,
            provider: script.provider,
            model: script.model,
            promptVersion: script.promptVersion,
            generatedAt: new Date(),
          },
        }),
        prisma.inductionVideoJob.update({
          where: { id: job.id },
          data: { status: InductionVideoJobStatus.SUCCEEDED, finishedAt: new Date() },
        }),
        prisma.aiUsageEvent.create({
          data: {
            jobSiteId: job.video.jobSite.id,
            videoId: job.videoId,
            purpose: 'script',
            provider: script.provider,
            model: script.model,
            tokensPrompt: script.tokensPrompt,
            tokensOutput: script.tokensOutput,
            estimatedPence: estimateScriptPence(script.tokensPrompt, script.tokensOutput),
          },
        }),
      ]);
      await record(job.videoId, 'SCRIPT_GENERATED', SYSTEM_ACTOR,
        `${script.scenes.length} scenes · ${script.model}`);
      done++;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed.';
      await prisma.inductionVideoJob.update({
        where: { id: job.id },
        data: {
          status: InductionVideoJobStatus.FAILED,
          error: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      await prisma.inductionVideo.update({
        where: { id: job.videoId },
        data: { status: InductionVideoStatus.GENERATION_FAILED },
      });
      await record(job.videoId, 'GENERATION_FAILED', SYSTEM_ACTOR, message.slice(0, 300));
    }
  }
  return done;
}

/**
 * Roughly what a script cost, in pence, at the rates current when this was
 * written. Indicative only - it is for spotting a site that costs ten times the
 * others, not for invoicing.
 */
function estimateScriptPence(promptTokens?: number, outputTokens?: number): number | null {
  if (promptTokens === undefined && outputTokens === undefined) return null;
  const inputPencePerM = 200; // ~£2 per million input tokens
  const outputPencePerM = 800; // ~£8 per million output tokens
  const pence =
    ((promptTokens ?? 0) * inputPencePerM + (outputTokens ?? 0) * outputPencePerM) / 1_000_000;
  return Math.max(0, Math.round(pence));
}

/** Edit one scene's narration. Returns an approved script to review. */
export async function editScene(
  actor: VideoActor,
  sceneId: string,
  narration: string,
): Promise<VideoResult<{ videoId: string }>> {
  const scene = await prisma.inductionVideoScene.findUnique({
    where: { id: sceneId },
    include: {
      video: {
        select: {
          id: true,
          jobSiteId: true,
          status: true,
          // Needed to DELETE them, not just unlink them, when an edit
          // invalidates the whole script's captions and transcript.
          captionsBlobPath: true,
          transcriptBlobPath: true,
        },
      },
    },
  });
  if (!scene || !guard(actor, scene.video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  const text = narration.trim();
  if (text.length < 10) return { ok: false, error: 'Narration is too short.' };
  if (text.length > 1200) return { ok: false, error: 'Narration is too long.' };
  if (scene.video.status === InductionVideoStatus.PUBLISHED) {
    return { ok: false, error: 'A published version cannot be edited. Generate a new version.' };
  }
  /*
   * NOT WHILE IT IS BEING SPOKEN. A scene edited mid-run would be synthesised
   * from the old words or the new ones depending on where the job had got to,
   * and nobody could tell which afterwards.
   */
  if (scene.video.status === InductionVideoStatus.NARRATION_GENERATING) {
    return {
      ok: false,
      error: 'This version is being narrated. Wait for that to finish before editing it.',
    };
  }
  /*
   * A COMPANY MODULE IS NOT A SITE'S TO REWRITE. Its words were issued by a
   * Director and apply to every project; a site that genuinely differs records
   * an override against the module, with a reason, where the departure is
   * visible - not quietly in one video's script.
   */
  if (scene.moduleRevisionId) {
    return {
      ok: false,
      error:
        'This is company induction content and is managed centrally. To change it for this project only, record an override in the project’s induction settings.',
    };
  }

  await prisma.inductionVideoScene.update({
    where: { id: sceneId },
    data: {
      narration: text,
      /*
       * THE AUDIO NO LONGER SAYS THIS. Clearing it is what stops an operative
       * hearing the old sentence while reading the new one; the next narration
       * run pays for this one scene again and reuses the rest.
       */
      audioBlobPath: null,
      audioDurationMs: null,
      audioHash: null,
    },
  });
  if (scene.audioBlobPath) await deleteMedia(scene.audioBlobPath);
  const priorCaptions = scene.video.captionsBlobPath;
  const priorTranscript = scene.video.transcriptBlobPath;
  /*
   * AN EDIT UNDOES AN APPROVAL. What was approved was the text as it stood; the
   * approval cannot survive its own subject being rewritten.
   */
  if (
    scene.video.status === InductionVideoStatus.SCRIPT_APPROVED ||
    scene.video.status === InductionVideoStatus.NARRATION_READY
  ) {
    await prisma.inductionVideo.update({
      where: { id: scene.video.id },
      data: {
        status: InductionVideoStatus.SCRIPT_READY,
        approvedAt: null,
        approvedByUserId: null,
        /*
         * The realm and the admin id go too. Added when the Admin Centre gained
         * approval authority and missed on THIS path: a withdrawn approval that
         * kept "approved from the Admin Centre" against it would attribute an
         * approval that no longer exists.
         */
        approvedByAdminId: null,
        approvedByRealm: null,
        approvedByName: null,
        /*
         * The captions and the transcript were built from the whole script, so
         * an edit invalidates them as surely as it invalidates the scene's own
         * audio. Cleared rather than left to be served alongside new words.
         */
        narrationAt: null,
        narrationDurationMs: null,
        narrationHash: null,
        captionsBlobPath: null,
        transcriptBlobPath: null,
      },
    });
    /*
     * And removed from storage, not merely unlinked. Clearing the paths alone
     * left paid-for files in the container with nothing pointing at them - which
     * only became visible while working out what deleting a version must clean up.
     */
    for (const path of [priorCaptions, priorTranscript]) {
      if (path) await deleteMedia(path);
    }
    await record(scene.video.id, 'APPROVAL_WITHDRAWN', actor,
      `${scene.heading} was edited after approval`);
  }
  await record(scene.video.id, 'SCENE_EDITED', actor, scene.heading);
  return { ok: true, value: { videoId: scene.video.id } };
}

/** Remove an optional scene. A required one may never be removed. */
export async function removeScene(
  actor: VideoActor,
  sceneId: string,
): Promise<VideoResult<{ videoId: string }>> {
  const scene = await prisma.inductionVideoScene.findUnique({
    where: { id: sceneId },
    include: { video: { select: { id: true, jobSiteId: true, status: true } } },
  });
  if (!scene || !guard(actor, scene.video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
  }
  if (scene.moduleRevisionId) {
    return {
      ok: false,
      error:
        'This is company induction content. To leave it out of this project, exclude the module in the project’s induction settings — where the decision and its reason are recorded.',
    };
  }
  if (scene.required) {
    return {
      ok: false,
      error: `“${scene.heading}” is required by this project's own records and cannot be removed.`,
    };
  }
  if (scene.video.status === InductionVideoStatus.PUBLISHED) {
    return { ok: false, error: 'A published version cannot be edited. Generate a new version.' };
  }
  if (scene.video.status === InductionVideoStatus.NARRATION_GENERATING) {
    return {
      ok: false,
      error: 'This version is being narrated. Wait for that to finish before editing it.',
    };
  }
  await prisma.inductionVideoScene.delete({ where: { id: sceneId } });
  // Its audio is now unreachable and describes a scene that has gone.
  if (scene.audioBlobPath) await deleteMedia(scene.audioBlobPath);
  if (scene.video.status === InductionVideoStatus.NARRATION_READY) {
    await prisma.inductionVideo.update({
      where: { id: scene.video.id },
      data: {
        /*
         * BACK TO APPROVED, not still "narration ready": the remaining scenes
         * keep their audio, but the captions and transcript described an
         * induction that included this scene. Re-narrating costs the captions
         * only - every kept scene is reused - so the honest state is the one
         * that asks for it.
         */
        status: InductionVideoStatus.SCRIPT_APPROVED,
        narrationAt: null,
        narrationDurationMs: null,
        narrationHash: null,
        captionsBlobPath: null,
        transcriptBlobPath: null,
      },
    });
  }
  await record(scene.video.id, 'SCENE_REMOVED', actor, scene.heading);
  return { ok: true, value: { videoId: scene.video.id } };
}

/** Approve a script. Directors and Site Managers, by the owner's decision. */
export async function approveScript(
  actor: VideoActor,
  videoId: string,
): Promise<VideoResult<{ approved: true }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: { id: true, jobSiteId: true, status: true, version: true },
  });
  if (!video || !guard(actor, video.jobSiteId)) return { ok: false, error: 'Not available.' };
  if (!actor.canApprove) {
    return { ok: false, error: 'Only a Director or Site Manager may approve an induction script.' };
  }
  if (video.status !== InductionVideoStatus.SCRIPT_READY) {
    return { ok: false, error: 'Only a script that is ready for review can be approved.' };
  }
  const sceneCount = await prisma.inductionVideoScene.count({ where: { videoId } });
  if (sceneCount === 0) return { ok: false, error: 'There is nothing to approve.' };

  await prisma.inductionVideo.update({
    where: { id: videoId },
    data: {
      status: InductionVideoStatus.SCRIPT_APPROVED,
      approvedAt: new Date(),
      approvedByUserId: actor.userId,
      approvedByAdminId: actor.adminId,
      approvedByName: actor.name,
      approvedByRealm: actor.realm,
    },
  });
  await record(videoId, 'SCRIPT_APPROVED', actor, `Version ${video.version}`);
  return { ok: true, value: { approved: true } };
}

/**
 * The statuses a version may be permanently deleted in.
 *
 * Everything before the formal workflow starts, and nothing after it. Approving
 * is the line: once a script has been approved it has been narrated, rendered,
 * published or superseded, and those are records rather than drafts.
 *
 * GENERATION_FAILED is here because a failed attempt is rubbish by definition, and
 * INFORMATION_REQUIRED because the code already treats a blocked attempt as not
 * really a version - it reuses the row rather than burning a number.
 */
const DELETABLE: InductionVideoStatus[] = [
  InductionVideoStatus.DRAFT,
  InductionVideoStatus.INFORMATION_REQUIRED,
  InductionVideoStatus.SCRIPT_READY,
  InductionVideoStatus.GENERATION_FAILED,
];

/**
 * MAY THIS VERSION BE DELETED — the question the UI asks before offering it.
 *
 * Exactly the conditions `deleteVideoVersion` enforces, minus the ones it can only
 * check on the row itself (a job in flight). Kept here, beside them, so the button
 * and the refusal cannot disagree: a delete control that is offered and then
 * refused is worse than no control, and one that is hidden when it would have
 * worked is the clutter the whole change is meant to remove.
 *
 * This is NOT the guard. The service re-checks everything.
 */
export function versionMayBeDeleted(v: {
  status: string;
  publishedAt: Date | null;
  supersededAt: Date | null;
  viewCount: number;
}): boolean {
  if (v.publishedAt || v.status === InductionVideoStatus.PUBLISHED) return false;
  if (v.viewCount > 0) return false;
  if (v.supersededAt) return false;
  return (DELETABLE as string[]).includes(v.status);
}

/**
 * PERMANENTLY DELETE A VERSION THAT NEVER ENTERED THE RECORD.
 *
 * During testing and content iteration, unwanted drafts accumulate and there was
 * no way to remove them. This deletes one outright - no DISCARDED status, because
 * a pile of hidden drafts is the same clutter wearing a different hat.
 *
 * ── STATUS IS NOT A SUFFICIENT GUARD ──────────────────────────────────────
 *
 * A SCRIPT_READY version can be carrying narration. Editing a scene on an
 * approved version sends it back to SCRIPT_READY but clears only THAT scene's
 * audio - the rest keep theirs, and the captions and transcript paths are cleared
 * without the blobs being removed. So every condition below is checked
 * independently of the status, and the media is cleaned up rather than assumed
 * absent.
 *
 * ── WHAT MAKES A VERSION UNTOUCHABLE ──────────────────────────────────────
 *
 * The same two facts the retention sweep already uses, for the same reasons:
 *
 *   NEVER PUBLISHED  and the status is checked as well as publishedAt, because a
 *                    withdrawal clears publishedAt - a version that was published
 *                    and then withdrawn is still one operatives may have seen.
 *   NEVER WATCHED    one view row and it is the record of somebody's induction,
 *                    permanently.
 *
 * Plus: not superseded, and no job in flight. A job holds this row as its lock, so
 * deleting it mid-run would leave the runner writing to something that is gone.
 *
 * ── THE DELETION ITSELF IS NOT RECORDED ANYWHERE ──────────────────────────
 *
 * Deliberate, and the reason it is acceptable: the version's own events cascade
 * away with it, and there is no general audit log to write to. What makes that
 * safe is the guard rather than the bookkeeping - a version that satisfies every
 * condition above was never approved, never narrated into anything anyone kept,
 * never published and never watched. It was never part of the record, so its
 * removal leaves no hole in one.
 *
 * SPEND IS NOT DELETED. AiUsageEvent rows carry the videoId as a plain column
 * with no relation, so the cost of a discarded draft still counts against the
 * daily cap. A delete that reduced recorded spend would be a way to buy past the
 * budget guard.
 */
export async function deleteVideoVersion(
  actor: VideoActor,
  videoId: string,
): Promise<VideoResult<{ deleted: true; siteId: string; version: number }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      jobSiteId: true,
      status: true,
      version: true,
      supersededAt: true,
      publishedAt: true,
      captionsBlobPath: true,
      transcriptBlobPath: true,
      videoBlobPath: true,
      scenes: { select: { audioBlobPath: true } },
      _count: { select: { views: true } },
      jobs: { select: { status: true } },
    },
  });
  if (!video || !guard(actor, video.jobSiteId)) return { ok: false, error: 'Not available.' };

  /*
   * Deleting is a Director's or Site Manager's - an Admin Centre OWNER or ADMIN
   * being their equivalent. It is irreversible, and the existing prepare/approve
   * split exists precisely to keep irreversible decisions about the record away
   * from roles that may prepare one.
   */
  if (!actor.canApprove) {
    return {
      ok: false,
      error: 'Only a Director or Site Manager may delete an induction script version.',
    };
  }

  if (video.publishedAt || video.status === InductionVideoStatus.PUBLISHED) {
    return {
      ok: false,
      error:
        'This version has been published to operatives. Withdraw it instead — a published induction is a record.',
    };
  }
  if (video._count.views > 0) {
    return {
      ok: false,
      error:
        'An operative has watched this version, so it is the record of their induction and cannot be deleted.',
    };
  }
  if (video.supersededAt) {
    return {
      ok: false,
      error: 'This version has been superseded. It is kept as history rather than deleted.',
    };
  }
  if (video.jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING')) {
    return {
      ok: false,
      error: 'Something is still running on this version. It can be deleted once that finishes.',
    };
  }
  if (!(DELETABLE as string[]).includes(video.status)) {
    return {
      ok: false,
      error:
        'This version has been approved, so it is part of the approval workflow. Generate a new version instead, which supersedes it.',
    };
  }

  /*
   * MEDIA FIRST, ROW SECOND. If the row went first and a blob delete then failed,
   * the file would be orphaned with nothing left pointing at it. This way a
   * failure leaves the version intact and the operation can be retried.
   */
  const media = [
    ...video.scenes.map((s) => s.audioBlobPath),
    video.captionsBlobPath,
    video.transcriptBlobPath,
    video.videoBlobPath,
  ].filter((p): p is string => Boolean(p));
  for (const path of media) await deleteMedia(path);

  // Scenes, jobs, events and views all cascade.
  await prisma.inductionVideo.delete({ where: { id: videoId } });

  return {
    ok: true,
    value: { deleted: true, siteId: video.jobSiteId, version: video.version },
  };
}

/**
 * Supersede every earlier version of this site's video.
 *
 * Called when a version is approved - and kept as its own step because Phase 2
 * publishes rendered video, and only one version is current at a time. Earlier
 * versions are marked superseded, never deleted.
 */
export async function supersedeEarlierVersions(
  siteId: string,
  currentVideoId: string,
  actor: { name: string; realm: 'PLATFORM' | 'ADMIN' | null },
): Promise<number> {
  const earlier = await prisma.inductionVideo.findMany({
    where: {
      jobSiteId: siteId,
      id: { not: currentVideoId },
      supersededAt: null,
    },
    select: { id: true, version: true },
  });
  for (const v of earlier) {
    await prisma.inductionVideo.update({
      where: { id: v.id },
      data: { supersededAt: new Date() },
    });
    await record(v.id, 'SUPERSEDED', actor, `Replaced by a newer version`);
  }
  return earlier.length;
}

/** One version in full, for the editor. */
export async function getVideo(actor: VideoActor, videoId: string) {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    include: {
      jobSite: { select: { id: true, name: true } },
      scenes: { orderBy: { order: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      jobs: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });
  if (!video || !guard(actor, video.jobSiteId)) return null;
  const manifest = await manifestForSite(video.jobSiteId);
  return {
    video,
    stale: Boolean(video.sourceHash && manifest && video.sourceHash !== manifestHash(manifest)),
    warnings: manifest?.warnings ?? [],
    canApprove: actor.canApprove,
  };
}
