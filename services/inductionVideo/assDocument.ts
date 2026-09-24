import { VIDEO_FORMAT } from '@/services/inductionVideo/videoFormat';
import { textBox, type SceneVisual } from '@/services/inductionVideo/sceneVisual';

/**
 * The text layer of a scene, as an ASS document.
 *
 * ── WHY SUBTITLE FORMAT, FOR TEXT THAT IS NOT A SUBTITLE ──────────────────
 *
 * Text has to be drawn by something. ffmpeg's own `drawtext` needs one filter
 * per line with hand-computed y offsets, breaks on a colon or an apostrophe, and
 * is absent from several common builds - including the one this is validated
 * against. libass, which every build has, already does font shaping, alignment,
 * margins and line breaking properly. So the frame's words are written as an ASS
 * document and composited with the `ass` filter: one filter, real typography,
 * and a text layer that can be inspected as a file when something looks wrong.
 *
 * ── THE COLOUR TRAP ───────────────────────────────────────────────────────
 *
 * ASS colours are &HAABBGGRR - ALPHA FIRST AND THE CHANNELS REVERSED. Writing
 * &H00AEEF as though it were RGB does not produce SiteComply blue; it produces
 * a muddy orange, because the red and blue channels have swapped. It renders, it
 * looks deliberate, and nobody spots it until a brand review. Hence assColour(),
 * and hence a test that pins the exact string.
 *
 * ── THE TEXT IS STILL UNTRUSTED ───────────────────────────────────────────
 *
 * Narration is typed by a manager, and in ASS a brace opens an override block:
 * "{\\fs200}" would be executed as styling rather than shown as words. Braces are
 * replaced, newlines become the format's own \\N, and nothing a manager types can
 * restyle the frame - the same principle as escaping the SSML.
 */

/** #RRGGBB (or #RGB) → &HAABBGGRR, opaque. */
export function assColour(hex: string, alpha = 0): string {
  const raw = hex.replace('#', '').trim();
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a colour: ${hex}`);
  }
  const rr = full.slice(0, 2);
  const gg = full.slice(2, 4);
  const bb = full.slice(4, 6);
  const aa = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0');
  return `&H${aa}${bb}${gg}${rr}`.toUpperCase();
}

/** Make a manager's words safe to put in a dialogue line. */
export function assText(text: string): string {
  return text
    .replace(/\r/g, '')
    // A brace opens an override block: "{\fs200}" would be obeyed, not shown.
    .replace(/[{}]/g, '(')
    // Backslashes introduce the format's own escapes.
    .replace(/\\/g, '/')
    .replace(/\n/g, '\\N')
    .trim();
}

/** hh:mm:ss.cc — ASS keeps centiseconds, not milliseconds. */
export function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1_000);
  const cs = Math.round((total % 1_000) / 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * The font the frames are set in.
 *
 * A FAMILY NAME, resolved by fontconfig inside the renderer, not a path. The
 * platform's own UI is set in the system sans stack; there is no licensed brand
 * face to embed, and a missing file would silently fall back to something else
 * anyway. Overridable per deployment because a container's fonts are its own.
 */
export function visualFont(): string {
  return process.env.INDUCTION_VIDEO_FONT || 'DejaVu Sans';
}

const HEADING_SIZE = 72;
const BODY_SIZE = 50;
const FOOTER_SIZE = 34;

/**
 * One scene's text layer, covering the whole scene.
 *
 * Two events, not one: the heading sits against the top of the safe area and the
 * body below the middle, so a long heading grows downwards into space rather
 * than pushing the body off the frame.
 */
export function sceneAss(
  visual: SceneVisual,
  durationMs: number,
  footer?: string,
): string {
  const box = textBox();
  const font = visualFont();
  const end = assTime(Math.max(1_000, durationMs));

  const styles = [
    // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,
    // BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing,
    // Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR,
    // MarginV, Encoding
    `Style: Heading,${font},${HEADING_SIZE},${assColour(visual.palette.heading)},${assColour(visual.palette.heading)},${assColour(visual.palette.background)},${assColour(visual.palette.background)},-1,0,0,0,100,100,0,0,1,0,0,8,${box.left},${box.right},${box.top},1`,
    `Style: Body,${font},${BODY_SIZE},${assColour(visual.palette.body)},${assColour(visual.palette.body)},${assColour(visual.palette.background)},${assColour(visual.palette.background)},0,0,0,0,100,100,0,0,1,0,0,4,${box.left},${box.right},0,1`,
    `Style: Footer,${font},${FOOTER_SIZE},${assColour(visual.palette.rule)},${assColour(visual.palette.rule)},${assColour(visual.palette.background)},${assColour(visual.palette.background)},0,0,0,0,100,100,0,0,1,0,0,2,${box.left},${box.right},${Math.round(box.bottom / 2)},1`,
  ];

  /*
   * NINE FIELDS, NOT TEN. The Format line declares Layer, Start, End, Style,
   * Name, MarginL, MarginR, MarginV, Text - and everything after the eighth
   * comma is Text. An extra empty field here is not an error anybody sees in a
   * log: it renders, and every line on every frame silently begins with a stray
   * comma. It got through the first render and was caught by LOOKING at a frame.
   */
  const dialogue = (style: string, text: string) =>
    `Dialogue: 0,0:00:00.00,${end},${style},,0,0,0,${assText(text)}`;

  const events = [dialogue('Heading', visual.heading.toUpperCase())];
  if (visual.lines.length > 0) {
    events.push(
      `Dialogue: 0,0:00:00.00,${end},Body,,0,0,0,${visual.lines.map(assText).join('\\N')}`,
    );
  }
  if (footer) events.push(dialogue('Footer', footer));

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    // WITHOUT THESE the renderer assumes 384x288 and every size and margin is
    // scaled by a factor of three. The text would be unreadably small and
    // nothing would explain why.
    `PlayResX: ${VIDEO_FORMAT.width}`,
    `PlayResY: ${VIDEO_FORMAT.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Text',
    ...events,
    '',
  ].join('\n');
}
