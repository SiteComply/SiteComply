/**
 * Turning approved, narrated scenes into one portrait MP4.
 *
 * ── AN INTERFACE, AGAIN, AND FOR A BIGGER REASON THAN BEFORE ──────────────
 *
 * Speech had one plausible provider. Rendering has three plausible answers and
 * the choice is commercial, not technical: a cloud renderer (a new processor, a
 * DPA to sign, about £1.25 a video, no CPU of ours), a self-hosted encoder (no
 * new processor, no per-video cost, our CPU), or a dedicated worker later if
 * volume ever justifies one. So the pipeline talks to a VideoRenderer and the
 * engine is a deployment decision - which is what lets the platform be finished
 * and validated now, before that decision has been made.
 *
 * ── WHAT A RENDERER IS GIVEN, AND WHAT IT MUST NOT DO ─────────────────────
 *
 * It receives scenes that are already approved, already narrated and already
 * measured. It may not reorder them, re-word them, drop one or invent a frame:
 * the manifest decided the induction and the voice is the record of it. A
 * renderer's whole job is to put the agreed words and the agreed audio on screen
 * in the agreed order.
 */

export interface RenderScene {
  sceneType: string;
  heading: string;
  /** The approved narration. The frame shows what fits; the voice says it all. */
  narration: string;
  /** The synthesised audio for this scene. */
  audio: Buffer;
  /** Its measured length, which is what the scene's frame is held for. */
  durationMs: number;
}

export interface RenderRequest {
  siteName: string;
  version: number;
  scenes: RenderScene[];
}

export interface RenderOutput {
  mp4: Buffer;
  /** Measured from the finished file, not summed from the request. */
  durationMs: number;
  engine: string;
  /** Wall-clock seconds the render took, for the usage row. */
  renderSeconds: number;
}

export interface VideoRenderer {
  readonly engine: string;
  /** Indicative cost per minute of finished video, in pence. 0 for self-hosted. */
  readonly pencePerMinute: number;
  render(request: RenderRequest): Promise<RenderOutput>;
}

/**
 * Roughly what a render cost, in pence. Indicative, like every other figure in
 * the usage table: it exists to spot a site costing ten times the others.
 */
export function estimateRenderPence(durationMs: number, pencePerMinute: number): number {
  if (pencePerMinute <= 0) return 0;
  return Math.max(0, Math.round((durationMs / 60_000) * pencePerMinute));
}
