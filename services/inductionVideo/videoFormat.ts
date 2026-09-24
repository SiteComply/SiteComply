/**
 * The shape of an induction video, decided once and read everywhere.
 *
 * ── PORTRAIT, BY THE OWNER'S DECISION ─────────────────────────────────────
 *
 * 1080 × 1920, 9:16. An operative watches this at a site gate, on the phone in
 * their hand, standing up and usually in a hurry - not on a desk monitor. A
 * landscape video on that phone is a letterbox a third of the screen high, and
 * the first thing it teaches the operative is that the induction was not made
 * for them. Landscape may be added later; portrait is the primary format and
 * everything downstream is designed to it, not cropped to it afterwards.
 *
 * This module carries no Azure or renderer code on purpose. It is read by the
 * caption builder (how much text fits a line) and by the Phase 3 renderer (the
 * canvas and the safe areas), so both work to the same numbers rather than to
 * two sets that drift.
 */

export const VIDEO_FORMAT = {
  aspect: '9:16',
  width: 1080,
  height: 1920,
  /*
   * TEN, NOT THIRTY.
   *
   * Every frame of an induction scene is IDENTICAL - a colour, a heading, a few
   * lines and the brand mark. Encoding thirty of them a second spends two and a
   * half times the CPU to produce a slightly larger file that looks exactly the
   * same. Measured: 20 seconds of video took 2,378 ms at thirty and 961 ms at
   * ten, and the ten-frame file was smaller.
   *
   * That ratio matters because the encoder shares a small instance with every
   * request the platform serves: on the production B1, fifteen seconds of video
   * took ninety-five seconds to render at thirty frames. Nothing here moves, so
   * nothing is lost.
   */
  fps: 10,
  /** Kept as a single source of truth for the renderer's output settings. */
  container: 'mp4',
} as const;

/**
 * Safe areas as a fraction of the canvas.
 *
 * A phone's own furniture - the notch, the home indicator, a browser's chrome,
 * the player's controls - eats the top and bottom of a portrait frame. Nothing
 * that must be READ (a heading, an assembly point, a telephone number) may sit
 * outside these bounds.
 */
export const SAFE_AREA = {
  topFraction: 0.12,
  bottomFraction: 0.18,
  sideFraction: 0.07,
} as const;

/**
 * How long a caption line may be.
 *
 * PORTRAIT IS THE CONSTRAINT. At a legible size on a 1080-wide frame about 32
 * characters fit a line, and two lines is the most that can be read before the
 * next cue - so a cue is capped at 64. The usual broadcast figure of 84 assumes
 * a landscape frame and would wrap to four lines here, covering the visual it
 * is meant to caption.
 */
export const CAPTION_MAX_CHARS = 64;
export const CAPTION_MAX_LINES = 2;

/** The shortest cue that can actually be read, however fast the narration. */
export const CAPTION_MIN_MS = 1_200;
