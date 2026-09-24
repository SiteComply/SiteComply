import {
  InductionVideoStatus,
  InductionVideoJobKind,
  InductionVideoJobStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canApproveInductionVideo,
  canManageInductionVideos,
} from '@/services/inductionVideo/inductionVideoPermissions';
import { manifestForSite, generateScript, loadVideoSource } from '@/services/inductionVideo/scriptService';
import { deleteMedia } from '@/services/inductionVideo/mediaStorage';
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

/**
 * THE access rule for induction videos: the right role, and this project in the
 * viewer's assigned sites. Exported because Phase 2's media routes need exactly
 * this test - a second, hand-written copy of it in a route file is how a
 * download ends up readable by a manager from another project.
 */
export function canWorkOnVideoSite(viewer: PlatformViewer, siteId: string): boolean {
  return canManageInductionVideos(viewer.role) && viewer.siteIds.includes(siteId);
}

function guard(viewer: PlatformViewer, siteId: string): boolean {
  return canWorkOnVideoSite(viewer, siteId);
}

async function record(
  videoId: string,
  action: string,
  actorName: string,
  detail?: string,
): Promise<void> {
  await prisma.inductionVideoEvent.create({
    data: { videoId, action, actorName, detail },
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
}

/** Every version for one site, newest first. */
export async function listVideosForSite(
  viewer: PlatformViewer,
  siteId: string,
): Promise<VideoSummary[] | null> {
  if (!guard(viewer, siteId)) return null;
  const [site, rows, manifest] = await Promise.all([
    prisma.jobSite.findUnique({ where: { id: siteId }, select: { name: true } }),
    prisma.inductionVideo.findMany({
      where: { jobSiteId: siteId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { scenes: true } } },
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
    generatedAt: r.generatedAt,
    approvedAt: r.approvedAt,
    approvedByName: r.approvedByName,
    publishedAt: r.publishedAt,
    supersededAt: r.supersededAt,
    stale: Boolean(r.sourceHash && currentHash && r.sourceHash !== currentHash),
  }));
}

/** The readiness check: what the site can say, and what it must fix first. */
export async function readinessForSite(viewer: PlatformViewer, siteId: string) {
  if (!guard(viewer, siteId)) return null;
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
  viewer: PlatformViewer,
  siteId: string,
): Promise<VideoResult<{ videoId: string; version: number }>> {
  if (!guard(viewer, siteId)) return { ok: false, error: 'Not available.' };

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
            generatedByName: viewer.name,
          },
          select: { id: true },
        })
      : await prisma.inductionVideo.create({
          data: {
            jobSiteId: siteId,
            version,
            status: InductionVideoStatus.INFORMATION_REQUIRED,
            blockingReasons: manifest.missing as unknown as object,
            generatedByName: viewer.name,
          },
          select: { id: true },
        });
    await record(video.id, 'INFORMATION_REQUIRED', viewer.name,
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
          generatedByName: viewer.name,
        },
        select: { id: true },
      })
    : await prisma.inductionVideo.create({
        data: {
          jobSiteId: siteId,
          version,
          status: InductionVideoStatus.SCRIPT_GENERATING,
          generatedByName: viewer.name,
        },
        select: { id: true },
      });
  await prisma.inductionVideoJob.create({
    data: {
      videoId: video.id,
      kind: InductionVideoJobKind.SCRIPT,
      requestedByName: viewer.name,
    },
  });
  await record(video.id, 'SCRIPT_REQUESTED', viewer.name, `Version ${version}`);
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
      await record(job.videoId, 'SCRIPT_GENERATED', 'SiteComply',
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
      await record(job.videoId, 'GENERATION_FAILED', 'SiteComply', message.slice(0, 300));
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
  viewer: PlatformViewer,
  sceneId: string,
  narration: string,
): Promise<VideoResult<{ videoId: string }>> {
  const scene = await prisma.inductionVideoScene.findUnique({
    where: { id: sceneId },
    include: { video: { select: { id: true, jobSiteId: true, status: true } } },
  });
  if (!scene || !guard(viewer, scene.video.jobSiteId)) {
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
    await record(scene.video.id, 'APPROVAL_WITHDRAWN', viewer.name,
      `${scene.heading} was edited after approval`);
  }
  await record(scene.video.id, 'SCENE_EDITED', viewer.name, scene.heading);
  return { ok: true, value: { videoId: scene.video.id } };
}

/** Remove an optional scene. A required one may never be removed. */
export async function removeScene(
  viewer: PlatformViewer,
  sceneId: string,
): Promise<VideoResult<{ videoId: string }>> {
  const scene = await prisma.inductionVideoScene.findUnique({
    where: { id: sceneId },
    include: { video: { select: { id: true, jobSiteId: true, status: true } } },
  });
  if (!scene || !guard(viewer, scene.video.jobSiteId)) {
    return { ok: false, error: 'Not available.' };
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
  await record(scene.video.id, 'SCENE_REMOVED', viewer.name, scene.heading);
  return { ok: true, value: { videoId: scene.video.id } };
}

/** Approve a script. Directors and Site Managers, by the owner's decision. */
export async function approveScript(
  viewer: PlatformViewer,
  videoId: string,
): Promise<VideoResult<{ approved: true }>> {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    select: { id: true, jobSiteId: true, status: true, version: true },
  });
  if (!video || !guard(viewer, video.jobSiteId)) return { ok: false, error: 'Not available.' };
  if (!canApproveInductionVideo(viewer.role)) {
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
      approvedByUserId: viewer.id,
      approvedByName: viewer.name,
    },
  });
  await record(videoId, 'SCRIPT_APPROVED', viewer.name, `Version ${video.version}`);
  return { ok: true, value: { approved: true } };
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
  actorName: string,
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
    await record(v.id, 'SUPERSEDED', actorName, `Replaced by a newer version`);
  }
  return earlier.length;
}

/** One version in full, for the editor. */
export async function getVideo(viewer: PlatformViewer, videoId: string) {
  const video = await prisma.inductionVideo.findUnique({
    where: { id: videoId },
    include: {
      jobSite: { select: { id: true, name: true } },
      scenes: { orderBy: { order: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      jobs: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });
  if (!video || !guard(viewer, video.jobSiteId)) return null;
  const manifest = await manifestForSite(video.jobSiteId);
  return {
    video,
    stale: Boolean(video.sourceHash && manifest && video.sourceHash !== manifestHash(manifest)),
    warnings: manifest?.warnings ?? [],
    canApprove: canApproveInductionVideo(viewer.role),
  };
}
