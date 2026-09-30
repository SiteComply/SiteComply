import { InductionVideoStatus, LibraryRevisionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * WHERE THIS MODULE'S VIDEO HAS GOT TO, as one stage with one next action.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * Making a video of a company module used to span five pages and three objects a
 * user has no reason to know about. You wrote wording on the module page and it
 * ended there: nothing linked onward. To continue you had to work out for yourself
 * that a Library ASSET must exist, be marked GENERATED and be pointed at the
 * module; then produce from the asset page; then approve, narrate and render on a
 * third page; then press "Publish to operatives", which did not publish to
 * operatives; then find your way back to the asset to issue a REVISION. Four
 * different status vocabularies were in play at once — the module's, the asset's,
 * the production's and the revision's — and a module could read LIVE while its
 * asset read NO_FOOTAGE, its production VIDEO_READY and its revision DRAFT, all
 * true simultaneously and none of them saying "you are one step from done".
 *
 * So this collapses all four into ONE ordered stage and ONE next action. The module
 * page asks it and shows nothing else. Assets, productions and revisions are still
 * exactly what they were in the database; they are simply no longer the user's
 * problem.
 *
 * ── DERIVED, NEVER STORED ─────────────────────────────────────────────────
 *
 * Like `moduleStatus` and `libraryStatus` next door. A stored stage would be a
 * fifth source of truth to disagree with the other four, and the first job that
 * failed to write it would leave a module stuck on a screen that could not be got
 * off.
 *
 * ── WHY "GENERATE THE NARRATION" ALSO PRODUCES AND APPROVES ───────────────
 *
 * For a company video the script IS the module's issued wording, split into scenes
 * by sentence. There is no generation step and nothing for the model to write. The
 * Director read those exact words and issued them one step earlier, so asking them
 * to approve a script that is a mechanical re-rendering of their own sentences is a
 * ceremony that adds a page and decides nothing. The one action therefore provisions
 * the asset if needed, starts the production, approves it and queues the narration —
 * every one of those through the real service with the real authority check, so
 * nothing is bypassed, only unattended. The scene split is still shown at the review
 * step, so the words are never hidden.
 */

/*
 * The vocabulary and the types live in `videoStageShape.ts`, which imports nothing
 * from the server. The stepper needs the step NAMES, and importing them from here
 * dragged the Prisma client into the browser bundle — caught by the deploy gate's
 * leak check the first time it ran.
 */
export {
  VIDEO_STEPS,
  type VideoStageKey,
  type VideoNextAction,
  type ModuleVideoStage,
} from '@/services/inductionVideo/videoStageShape';
import {
  VIDEO_STEPS,
  type ModuleVideoStage,
  type VideoNextAction,
  type VideoStageKey,
} from '@/services/inductionVideo/videoStageShape';

const WORKING_JOB = ['QUEUED', 'RUNNING'];

function stageOf(
  key: VideoStageKey,
  step: number,
  detail: string,
  next: VideoNextAction | null,
  extra: { videoId?: string | null; assetId?: string | null; working?: boolean; live?: boolean } = {},
): ModuleVideoStage {
  return {
    stage: key,
    step,
    label: VIDEO_STEPS[step - 1],
    detail,
    working: extra.working ?? false,
    next,
    videoId: extra.videoId ?? null,
    assetId: extra.assetId ?? null,
    live: extra.live ?? false,
  };
}

/**
 * Work out the single stage for one module.
 *
 * Reads the module's revisions, the GENERATED asset that stands in for it (if one
 * has been provisioned), that asset's revisions and its productions. One query set,
 * because the answer depends on all of them and asking separately would let two
 * screens disagree.
 */
export async function moduleVideoStage(moduleId: string): Promise<ModuleVideoStage> {
  const module = await prisma.inductionModule.findUnique({
    where: { id: moduleId },
    select: {
      id: true,
      revisions: {
        select: { id: true, status: true, version: true, supersededAt: true },
        orderBy: { version: 'desc' },
      },
      libraryAssets: {
        where: { provenance: 'GENERATED' },
        select: {
          id: true,
          active: true,
          revisions: {
            select: {
              id: true,
              status: true,
              version: true,
              sourceModuleRevisionId: true,
              supersededAt: true,
            },
            orderBy: { version: 'desc' },
          },
          productions: {
            select: {
              id: true,
              status: true,
              version: true,
              supersededAt: true,
              publishedAt: true,
              jobs: { select: { kind: true, status: true } },
            },
            orderBy: { version: 'desc' },
          },
        },
      },
    },
  });

  if (!module) {
    return stageOf('NO_WORDING', 1, 'That module does not exist.', null);
  }

  // The wording IN FORCE: issued and not yet superseded. `issueRevision` supersedes
  // the previous one in the same transaction, so there is only ever one.
  const issuedWording = module.revisions.find(
    (r) => r.status === 'ISSUED' && r.supersededAt === null,
  ) ?? null;
  const draftWording = module.revisions.find((r) => r.status === 'DRAFT');

  /* ── STEPS 1 AND 2: THERE IS NOTHING TO MAKE A VIDEO OF YET ────────────── */
  if (!issuedWording) {
    if (!draftWording) {
      return stageOf(
        'NO_WORDING',
        1,
        'Write what this module should say. Nothing is generated until you issue it, '
          + 'so a draft reaches nobody.',
        { label: 'Write the wording', action: null, directorOnly: false, estimate: null },
      );
    }
    return stageOf(
      'WORDING_DRAFT',
      2,
      `Draft revision ${draftWording.version} is written but not issued, so there is `
        + 'nothing to narrate yet.',
      { label: 'Issue the wording', action: null, directorOnly: true, estimate: null },
    );
  }

  const asset = module.libraryAssets.find((a) => a.active) ?? module.libraryAssets[0] ?? null;

  /*
   * THE LIVE REVISION, and whether it still matches the wording in force. A module
   * re-issued after its video was made leaves the video saying the old words, which
   * is the one kind of staleness that matters here.
   */
  const liveRevision =
    asset?.revisions.find(
      (r) => r.status === LibraryRevisionStatus.ISSUED && r.supersededAt === null,
    ) ?? null;

  /*
   * A production still being worked on. Superseded and published ones are history;
   * what matters is whether something is mid-flight.
   */
  const inFlight =
    asset?.productions.find(
      (p) =>
        p.supersededAt === null &&
        p.status !== InductionVideoStatus.PUBLISHED,
    ) ?? null;

  /* ── THE TWO WAITS ────────────────────────────────────────────────────── */
  if (inFlight) {
    const busy = inFlight.jobs.filter((j) => WORKING_JOB.includes(j.status));
    if (
      inFlight.status === InductionVideoStatus.NARRATION_GENERATING ||
      busy.some((j) => j.kind === 'NARRATION')
    ) {
      return stageOf(
        'NARRATING',
        3,
        'Reading the wording aloud and writing the subtitles. This page updates itself '
          + 'when it finishes.',
        null,
        { videoId: inFlight.id, assetId: asset?.id, working: true },
      );
    }
    if (
      inFlight.status === InductionVideoStatus.VIDEO_GENERATING ||
      busy.some((j) => j.kind === 'RENDER')
    ) {
      return stageOf(
        'RENDERING',
        5,
        'Building the video. This takes a couple of minutes and the page updates itself '
          + 'when it is done.',
        null,
        { videoId: inFlight.id, assetId: asset?.id, working: true },
      );
    }

    if (inFlight.status === InductionVideoStatus.GENERATION_FAILED) {
      return stageOf(
        'FAILED',
        3,
        'Something went wrong while generating. Trying again starts from the wording, '
          + 'which is unchanged.',
        { label: 'Try again', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
        { videoId: inFlight.id, assetId: asset?.id },
      );
    }

    /* ── STEP 6: READY TO WATCH AND GO LIVE ─────────────────────────────── */
    if (inFlight.status === InductionVideoStatus.VIDEO_READY) {
      return stageOf(
        'PREVIEW',
        6,
        'Watch it through before it goes live. Publishing puts it in front of operatives '
          + 'in place of the written wording.',
        {
          label: 'Publish & issue',
          action: 'publishAndIssue',
          directorOnly: true,
          estimate: null,
        },
        { videoId: inFlight.id, assetId: asset?.id },
      );
    }

    /* ── STEP 4: NARRATED, READY TO RENDER ──────────────────────────────── */
    if (inFlight.status === InductionVideoStatus.NARRATION_READY) {
      return stageOf(
        'NARRATION_REVIEW',
        4,
        'Listen to the narration and read the subtitles. When they are right, build the '
          + 'video.',
        {
          label: 'Generate the video',
          action: 'generateVideo',
          directorOnly: true,
          estimate: 'about two minutes',
        },
        { videoId: inFlight.id, assetId: asset?.id },
      );
    }

    /*
     * SCRIPT_READY or SCRIPT_APPROVED: a production exists but has no audio yet -
     * either one started before this flow existed, or narration failed and put it
     * back. Either way the next move is the same, and `generateNarration` resumes
     * the existing production rather than starting a second one.
     */
    return stageOf(
      'READY_TO_NARRATE',
      3,
      'The wording is ready to be read aloud.',
      {
        label: 'Generate the narration',
        action: 'generateNarration',
        directorOnly: true,
        estimate: 'about 30 seconds',
      },
      { videoId: inFlight.id, assetId: asset?.id },
    );
  }

  /* ── STEP 8: LIVE ─────────────────────────────────────────────────────── */
  if (liveRevision) {
    const stale =
      liveRevision.sourceModuleRevisionId !== null &&
      liveRevision.sourceModuleRevisionId !== issuedWording.id;
    if (stale) {
      return stageOf(
        'LIVE_WORDING_MOVED_ON',
        8,
        'The video is live, but it says an earlier version of this wording. Generating '
          + 'again replaces it; until then operatives see the older words.',
        {
          label: 'Generate the narration again',
          action: 'generateNarration',
          directorOnly: true,
          estimate: 'about 30 seconds',
        },
        { assetId: asset?.id, live: true },
      );
    }
    return stageOf(
      'LIVE',
      8,
      'The video is live. Operatives are shown it in place of the written wording.',
      null,
      { assetId: asset?.id, live: true },
    );
  }

  /* ── STEP 3: WORDING IS IN FORCE, NOTHING MADE YET ─────────────────────── */
  return stageOf(
    'READY_TO_NARRATE',
    3,
    'The wording is in force. Turn it into a video by reading it aloud first.',
    {
      label: 'Generate the narration',
      action: 'generateNarration',
      directorOnly: true,
      estimate: 'about 30 seconds',
    },
    { assetId: asset?.id },
  );
}

/**
 * The same answer for a list of modules, in one pass.
 *
 * The index shows a Video column, and asking per row would be N query sets on a page
 * that already loads everything else in one.
 */
export async function moduleVideoStages(
  moduleIds: string[],
): Promise<Map<string, ModuleVideoStage>> {
  const out = new Map<string, ModuleVideoStage>();
  // Sequential on purpose: the catalogue is a handful of rows, and a parallel fan-out
  // of identical queries against one connection buys nothing here.
  for (const id of moduleIds) out.set(id, await moduleVideoStage(id));
  return out;
}
