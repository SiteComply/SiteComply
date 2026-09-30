/**
 * THE SHAPE OF A VIDEO STAGE, WITH NO SERVER IMPORTS.
 *
 * ── WHY IT IS ITS OWN FILE ────────────────────────────────────────────────
 *
 * `moduleVideoStage.ts` does the work, and to do it it imports `@prisma/client` and
 * `lib/prisma`. The stepper needs only the eight step NAMES and the types — but
 * importing them from the service dragged the whole Prisma client into the browser
 * bundle, which the deploy gate caught as a leak the moment it ran.
 *
 * So the shared vocabulary lives here, exactly as `inductionFlow.ts` does it for the
 * induction wizard: "declared here, in a module with no server imports, so the flow,
 * the wizard and the player all share one shape without a client bundle ever reaching
 * for Prisma."
 *
 * NOTHING IN THIS FILE MAY IMPORT PRISMA, or the leak comes back and the gate will
 * say so.
 */

/** The eight stages a user sees, plus the two waits and the two exceptions. */
export type VideoStageKey =
  | 'NO_WORDING'
  | 'WORDING_DRAFT'
  | 'READY_TO_NARRATE'
  | 'NARRATING'
  | 'NARRATION_REVIEW'
  | 'RENDERING'
  | 'PREVIEW'
  | 'LIVE'
  | 'LIVE_WORDING_MOVED_ON'
  | 'FAILED';

/** The eight numbered steps, in the order the owner specified. */
export const VIDEO_STEPS = [
  'Write wording',
  'Issue wording',
  'Generate narration',
  'Review narration',
  'Generate video',
  'Preview video',
  'Publish & issue',
  'Live',
] as const;

export interface VideoNextAction {
  /** The button. Imperative, and says what will happen, not which API it calls. */
  label: string;
  /**
   * The dispatcher action to post, or null when the next move is navigation or
   * editing that already exists on the page (writing the wording, issuing it).
   */
  action: string | null;
  /** True when only a Director may do it, so the page can explain rather than hide. */
  directorOnly: boolean;
  /** Roughly how long the user will wait afterwards, when it starts a job. */
  estimate: string | null;
}

export interface ModuleVideoStage {
  stage: VideoStageKey;
  /** 1-8, indexing VIDEO_STEPS. The stepper highlights this. */
  step: number;
  /** The stage in the user's words, e.g. "Review narration". */
  label: string;
  /** One sentence: what has happened, or what to do. */
  detail: string;
  /** A job is running; the page should poll and say so. */
  working: boolean;
  /** Null when there is nothing to do (LIVE, or waiting on a job). */
  next: VideoNextAction | null;
  /** The production, when one exists — for the preview player and the poll. */
  videoId: string | null;
  /** The provisioned asset, when one exists. Never shown as a concept. */
  assetId: string | null;
  /** True once an operative could be shown it. */
  live: boolean;
}
