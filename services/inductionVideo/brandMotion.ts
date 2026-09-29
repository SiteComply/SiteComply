/**
 * REUSABLE BRANDED ANIMATION ASSETS — rendered once, copied for ever.
 *
 * ── WHY PRECOMPUTED, AND WHY THAT IS THE WHOLE IDEA ───────────────────────
 *
 * The specification asked for "reusable branded animation assets". On a B1 instance
 * that shares one core with every HTTP request, animation rendered per induction is
 * not affordable: fifteen seconds of even STATIC video costs about ninety-five
 * seconds of CPU there, and per-frame movement roughly doubles it.
 *
 * A clip rendered ONCE and joined by stream copy costs about one second, whatever it
 * contains. Measured: forty-five seconds of joined parts took 43 ms of CPU on a
 * development core. So every piece of real motion in an induction — the opening
 * sting, the family bumpers, the closing plate — is built ahead of time, committed,
 * and concatenated. The induction gains a film's worth of movement for no render cost
 * at all.
 *
 * ── WHY THEY ARE COMMITTED FILES AND NOT BLOBS ────────────────────────────
 *
 * These are brand assets, not user content: they belong to the build the way the
 * vendored ffmpeg binary does. Committing them means they are always present, always
 * match the code that expects them, and need no storage round-trip, no manifest and
 * no availability check that narration and rendering could disagree about. Each is a
 * few hundred kilobytes.
 *
 * ── THE DURATION IS A CONTRACT ────────────────────────────────────────────
 *
 * Captions are built during NARRATION, before anything is rendered, by walking the
 * running order and accumulating durations. So the declared duration below and the
 * actual length of the file must agree, or every subtitle after the first bumper
 * drifts. `scripts/brand_motion_verify.ts` measures the files and fails if they do
 * not. Build them with `scripts/build_brand_motion.sh`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SceneFamily } from '@/services/inductionVideo/sceneTemplates';

export interface BrandMotionAsset {
  key: string;
  /** Must match the file exactly; captions are timed from this. */
  durationMs: number;
  /** What it is for, in the words a person would use. */
  purpose: string;
}

/** Where the committed clips live, overridable for a test or a rebuild. */
export function brandMotionDir(): string {
  return process.env.INDUCTION_BRAND_MOTION_DIR || join(process.cwd(), 'public', 'brand-motion');
}

export function brandMotionFile(key: string): string {
  return join(brandMotionDir(), `${key}.mp4`);
}

export function brandMotionExists(key: string): boolean {
  return existsSync(brandMotionFile(key));
}

/**
 * THE OPENING STING. Brand mark, then the site's name spoken over it by the
 * WELCOME scene that follows — the sting itself is silent so it can sit in front of
 * any induction without clashing with narration.
 */
export const STING: BrandMotionAsset = {
  key: 'sting',
  durationMs: 2400,
  purpose: 'Opening brand sequence',
};

/** THE CLOSING PLATE, after the last scene. */
export const CLOSING_PLATE: BrandMotionAsset = {
  key: 'closing',
  durationMs: 2000,
  purpose: 'Closing brand plate',
};

/**
 * ONE BUMPER PER FAMILY: a short animated title that tells a viewer what kind of
 * thing is coming next. This is what turns thirty scene types into about seven
 * recognisable sections.
 */
export const FAMILY_BUMPERS: Record<SceneFamily, BrandMotionAsset> = {
  OPENING: { key: 'bumper-opening', durationMs: 1200, purpose: 'Welcome' },
  PROJECT: { key: 'bumper-project', durationMs: 1200, purpose: 'This project' },
  EMERGENCY: { key: 'bumper-emergency', durationMs: 1400, purpose: 'In an emergency' },
  HAZARD: { key: 'bumper-hazard', durationMs: 1400, purpose: 'Hazards and controls' },
  ACCESS: { key: 'bumper-access', durationMs: 1200, purpose: 'Getting around site' },
  WELFARE: { key: 'bumper-welfare', durationMs: 1200, purpose: 'Welfare and environment' },
  STANDARDS: { key: 'bumper-standards', durationMs: 1200, purpose: 'What we expect' },
  CLOSING: { key: 'bumper-closing', durationMs: 1200, purpose: 'Before you start' },
};

/** Every asset the build must produce. */
export function allBrandMotionAssets(): BrandMotionAsset[] {
  return [STING, CLOSING_PLATE, ...Object.values(FAMILY_BUMPERS)];
}

/**
 * Is the whole set present?
 *
 * All or nothing on purpose. A half-built set would mean narration timing one running
 * order and the renderer producing another, and the symptom would be subtitles
 * drifting further out of step as the video goes on — which is far harder to
 * recognise than no animation at all.
 */
export function brandMotionReady(): boolean {
  return allBrandMotionAssets().every((a) => brandMotionExists(a.key));
}
