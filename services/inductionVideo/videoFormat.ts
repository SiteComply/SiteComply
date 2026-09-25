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
   * TWENTY-FIVE, BECAUSE THE VIDEO IS NO LONGER ONLY STATIC FRAMES.
   *
   * It was ten. Every frame of a GENERATED scene is identical - a colour, a
   * heading, a few lines, the brand mark - so encoding thirty a second spent two
   * and a half times the CPU for a file that looked exactly the same. Measured at
   * the time: 20 seconds took 2,378 ms at thirty and 961 ms at ten, and the
   * ten-frame file was smaller.
   *
   * The Library changes the premise. A finished induction now concatenates
   * generated scenes with real FOOTAGE - a company introduction, a manual handling
   * demonstration - and film at ten frames a second judders visibly. The join is a
   * stream copy, so every segment must share one framerate: there is no mixing a
   * static scene at ten with footage at twenty-five.
   *
   * So one rate for the whole pipeline, chosen for the hardest content in it
   * rather than the easiest. The cost is real and lands on the generated scenes -
   * on a B1 instance, fifteen seconds of static video took ninety-five seconds to
   * render at thirty - but rendering is a queued job whose page now refreshes
   * itself, so a slower render is an inconvenience rather than a wait. What it
   * actually spends is the shared instance's CPU, which is the argument for a
   * larger plan rather than for worse video.
   */
  fps: 25,
  /** Kept as a single source of truth for the renderer's output settings. */
  container: 'mp4',
} as const;

/**
 * THE AUDIO SPEC, AND WHY IT HAS TO LIVE HERE.
 *
 * An induction is joined with the concat demuxer and `-c copy`. That is a stream
 * copy, so every part must already agree on codec, sample rate AND CHANNEL COUNT.
 * The video side of that agreement was in VIDEO_FORMAT from the start; the audio
 * side was not, and the two encoders drifted the moment the Library existed:
 * generated scenes took their channel count from the narration mp3 (Azure speech
 * returns `...-mono-mp3`, so one channel) while library footage was forced to two.
 *
 * The join does not fail on that. It writes the FIRST part's channel layout into
 * the track header and copies every later part's frames in underneath it, so the
 * file claims mono and contains stereo, or the reverse, and warns
 * `Non-monotonic DTS` at each boundary. ffmpeg's own decoder reads the in-band
 * configuration and plays it anyway, which is exactly why this survived testing;
 * a stricter player is entitled not to.
 *
 * TWO CHANNELS, not one: upmixing mono narration is a duplicated channel and
 * costs nothing at a fixed 96k, whereas downmixing filmed footage to mono throws
 * away something a supplier was paid for.
 */
export const AUDIO_FORMAT = {
  codec: 'aac',
  bitrate: '96k',
  sampleRate: 44100,
  channels: 2,
} as const;

/**
 * The encoder flags for that spec. Both encoders call this rather than writing
 * the flags out, so there is one place to change and nowhere to disagree.
 */
export function audioEncodeArgs(): string[] {
  return [
    '-c:a', AUDIO_FORMAT.codec,
    '-b:a', AUDIO_FORMAT.bitrate,
    '-ar', String(AUDIO_FORMAT.sampleRate),
    '-ac', String(AUDIO_FORMAT.channels),
  ];
}

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
