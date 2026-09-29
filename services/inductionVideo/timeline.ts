/**
 * THE RUNNING ORDER — computed once, obeyed by two places that must not disagree.
 *
 * ── WHY THIS HAD TO EXIST BEFORE ANY ANIMATION COULD ──────────────────────
 *
 * Captions are built during NARRATION, by walking the scenes in order and adding up
 * their durations. The renderer walks the same scenes later and produces the video.
 * That worked while the two lists were identical.
 *
 * Inserting branded clips between scenes breaks it: if the renderer adds a 1.4-second
 * bumper the caption builder knew nothing about, every subtitle after it is 1.4
 * seconds early, and each further bumper adds more. The failure is not a crash. It is
 * a video whose subtitles drift further out of step the longer somebody watches, which
 * is the kind of fault that gets shipped.
 *
 * So the insertions are decided HERE, by a pure function of the scene list, and both
 * sides call it. There is no availability check, no I/O and no randomness: given the
 * same scenes, both sides get the same running order, always.
 *
 * ── WHERE BUMPERS GO ──────────────────────────────────────────────────────
 *
 * One per RUN of a family, not one per scene. Five hazard scenes in a row get a single
 * "Hazards and controls" bumper; a bumper before each would be a tic rather than a
 * signpost. A family that appears again later gets another, because by then the viewer
 * has been somewhere else.
 */
import { templateFor, type SceneFamily } from '@/services/inductionVideo/sceneTemplates';
import {
  CLOSING_PLATE,
  FAMILY_BUMPERS,
  STING,
  brandMotionReady,
} from '@/services/inductionVideo/brandMotion';

export interface TimelineScene {
  sceneType: string;
  /** The measured length of this scene's audio, or of its footage. */
  durationMs: number;
}

export type TimelinePart =
  /** A precomputed branded clip: copied in, contributes time and no captions. */
  | { kind: 'BRAND'; assetKey: string; durationMs: number; label: string }
  /** One of the caller's scenes, at this index in the list it passed in. */
  | { kind: 'SCENE'; index: number; durationMs: number };

/**
 * The full running order for these scenes.
 *
 * `enabled` exists so both callers can be told the same thing about whether the brand
 * assets are in play. It defaults to whether the committed set is complete, which is
 * a property of the deployment and therefore the same answer in both processes.
 */
export function buildTimeline(
  scenes: TimelineScene[],
  enabled: boolean = brandMotionReady(),
): TimelinePart[] {
  const parts: TimelinePart[] = [];
  // A scene with no measured duration contributes nothing and is skipped by the
  // caption builder too; it must not trigger a bumper either.
  const real = scenes
    .map((s, index) => ({ ...s, index }))
    .filter((s) => Math.round(s.durationMs || 0) > 0);
  if (real.length === 0) return [];

  if (enabled) {
    parts.push({
      kind: 'BRAND', assetKey: STING.key, durationMs: STING.durationMs, label: STING.purpose,
    });
  }

  let previousFamily: SceneFamily | null = null;
  for (const scene of real) {
    const template = templateFor(scene.sceneType);
    const startsNewRun = template.family !== previousFamily;
    if (enabled && template.bumper && startsNewRun) {
      const bumper = FAMILY_BUMPERS[template.family];
      parts.push({
        kind: 'BRAND', assetKey: bumper.key, durationMs: bumper.durationMs,
        label: bumper.purpose,
      });
    }
    parts.push({ kind: 'SCENE', index: scene.index, durationMs: scene.durationMs });
    previousFamily = template.family;
  }

  if (enabled) {
    parts.push({
      kind: 'BRAND', assetKey: CLOSING_PLATE.key, durationMs: CLOSING_PLATE.durationMs,
      label: CLOSING_PLATE.purpose,
    });
  }
  return parts;
}

/** Total running time of a timeline, for a duration estimate or a sanity check. */
export function timelineDurationMs(parts: TimelinePart[]): number {
  return parts.reduce((n, p) => n + Math.max(0, Math.round(p.durationMs || 0)), 0);
}

/** How much of the running time is branded motion rather than narrated scene. */
export function brandedMs(parts: TimelinePart[]): number {
  return parts
    .filter((p) => p.kind === 'BRAND')
    .reduce((n, p) => n + p.durationMs, 0);
}
