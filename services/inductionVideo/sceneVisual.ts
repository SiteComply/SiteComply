import { SAFE_AREA, VIDEO_FORMAT } from '@/services/inductionVideo/videoFormat';

/**
 * What a scene LOOKS like: the frame behind the voice.
 *
 * ── THE SCREEN IS NOT THE SCRIPT ──────────────────────────────────────────
 *
 * Putting the whole narration on screen is worse than putting a little of it
 * there. People read faster than a voice speaks, so a full paragraph is read in
 * four seconds and then ignored for the remaining twenty - and an operative who
 * has stopped listening has stopped being inducted. The frame carries the
 * heading and a few anchors; the words themselves are the narration's job, and
 * the captions carry them in full for anyone who needs them.
 *
 * ── A SENTENCE IS NEVER CUT ───────────────────────────────────────────────
 *
 * The one rule that matters here. "Do not enter the basement without a permit"
 * truncated to fit becomes "Do not enter the basement" - which is a different
 * instruction, and a more dangerous one. So a sentence either fits whole or it
 * does not appear on screen at all. Nothing is lost by leaving it out: it is
 * still spoken, still captioned, still in the transcript.
 *
 * ── TONE COMES FROM THE SCENE TYPE, NOT FROM THE WORDS ────────────────────
 *
 * The rules engine already decided what kind of scene this is. An emergency
 * scene is red because it is an emergency scene, not because a model judged the
 * text urgent - the same reason the manifest, and not a prompt, decides which
 * scenes exist.
 */

export type VisualTone = 'BRAND' | 'ALERT' | 'SAFE' | 'NEUTRAL';

export interface VisualPalette {
  background: string;
  heading: string;
  body: string;
  rule: string;
}

/** The SiteComply palette, from app/globals.css. */
const COLOURS = {
  brandBlue: '#00AEEF',
  brandDeep: '#003A54',
  safeGreen: '#39B54A',
  danger: '#B91C1C',
  ink: '#0F172A',
  paper: '#FFFFFF',
  hivis: '#FACC15',
  mutedOnDark: '#D7EBF4',
} as const;

const PALETTES: Record<VisualTone, VisualPalette> = {
  // The welcome and the close: brand blue, the only place it dominates a frame.
  BRAND: {
    background: COLOURS.brandDeep,
    heading: COLOURS.paper,
    body: COLOURS.mutedOnDark,
    rule: COLOURS.brandBlue,
  },
  // Emergencies and the high-risk scenes. Red is reserved for these, so it keeps
  // meaning something when it appears.
  ALERT: {
    background: '#3B0A0A',
    heading: COLOURS.paper,
    body: '#FFD9D9',
    rule: COLOURS.danger,
  },
  // Where to go and who to find: the green that already means "compliant".
  SAFE: {
    background: '#0B2410',
    heading: COLOURS.paper,
    body: '#D7F5DC',
    rule: COLOURS.safeGreen,
  },
  NEUTRAL: {
    background: COLOURS.ink,
    heading: COLOURS.paper,
    body: '#D8DEE9',
    rule: COLOURS.brandBlue,
  },
};

const ALERT_SCENES = new Set([
  'EMERGENCY_PROCEDURES',
  'INCIDENT_REPORTING',
  'SITE_HAZARDS',
  'EXISTING_RISKS',
  'HIGH_RISK_ACTIVITIES',
  'ASBESTOS',
  'WORK_AT_HEIGHT',
  'SIGNIFICANT_RISKS',
  'SERVICES_ISOLATION',
  'TEMPORARY_WORKS',
]);

const SAFE_SCENES = new Set([
  'FIRE_MUSTER_POINT',
  'FIRST_AID',
  'EMERGENCY_CONTACTS',
  'PPE',
  'SITE_RULES',
  'PERMITS',
]);

const BRAND_SCENES = new Set(['WELCOME', 'PROJECT_OVERVIEW', 'CLOSING']);

export function toneForScene(sceneType: string): VisualTone {
  if (ALERT_SCENES.has(sceneType)) return 'ALERT';
  if (SAFE_SCENES.has(sceneType)) return 'SAFE';
  if (BRAND_SCENES.has(sceneType)) return 'BRAND';
  return 'NEUTRAL';
}

export interface SceneVisual {
  sceneType: string;
  heading: string;
  /** Whole sentences that fit, already wrapped for the screen. */
  lines: string[];
  tone: VisualTone;
  palette: VisualPalette;
  /** True when the narration says more than the frame shows. */
  moreSpokenThanShown: boolean;
}

/* ── How much text a portrait frame holds ──────────────────────────────────
 *
 * 1080 wide inside a 7% side margin leaves about 930px. At the body size that
 * is roughly 34 characters a line - the same arithmetic behind the caption
 * limit, and the reason both live next to VIDEO_FORMAT rather than being
 * guessed twice.
 */
const BODY_CHARS_PER_LINE = 34;
/*
 * FIVE LINES, NOT EIGHT. Eight lines of thirty-four characters is a wall of text
 * on a phone held at a site gate - it is a paragraph, and a paragraph on screen
 * is read once and then ignored while the voice carries on. Five is about the
 * most that still reads as a few anchors. The effect is that a very long
 * sentence no longer fits, which is the point: it stays with the voice and the
 * captions rather than filling the frame.
 */
const MAX_BODY_LINES = 5;
/** At most three sentences: past that nobody reads the frame at all. */
const MAX_SENTENCES = 3;

/** Wrap one sentence for the frame, or return null when it cannot fit whole. */
function wrapWhole(sentence: string, maxLines: number): string[] | null {
  const words = sentence.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    // A single word longer than a line would have to be broken, which for a
    // number or a postcode changes what it says. Refuse the sentence instead.
    if (word.length > BODY_CHARS_PER_LINE) return null;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= BODY_CHARS_PER_LINE) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length > maxLines) return null;
    }
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : null;
}

/** Split narration into sentences, keeping their punctuation. */
export function sentencesOf(narration: string): string[] {
  const text = narration.trim().replace(/\s+/g, ' ');
  if (!text) return [];
  return text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/**
 * The frame for one scene.
 *
 * `heading` comes from the rules engine and is shown as given - an editor may
 * change the narration but not the heading, so the frame and the manifest cannot
 * disagree about what this scene is.
 */
export function sceneVisual(scene: {
  sceneType: string;
  heading: string;
  narration: string;
}): SceneVisual {
  const tone = toneForScene(scene.sceneType);
  const sentences = sentencesOf(scene.narration);
  const lines: string[] = [];
  let shown = 0;

  for (const sentence of sentences) {
    if (shown >= MAX_SENTENCES) break;
    const remaining = MAX_BODY_LINES - lines.length;
    if (remaining <= 0) break;
    const wrapped = wrapWhole(sentence, remaining);
    if (!wrapped) continue; // too long for the frame: left to the voice
    lines.push(...wrapped);
    shown++;
  }

  return {
    sceneType: scene.sceneType,
    heading: scene.heading,
    lines,
    tone,
    palette: PALETTES[tone],
    moreSpokenThanShown: shown < sentences.length,
  };
}

/**
 * Where the text sits, in pixels, inside the phone's safe area.
 *
 * Exported because the renderer and its tests must agree, and because a future
 * landscape format changes these numbers and nothing else.
 */
export function textBox(): { left: number; right: number; top: number; bottom: number } {
  const side = Math.round(VIDEO_FORMAT.width * SAFE_AREA.sideFraction);
  return {
    left: side,
    right: side,
    top: Math.round(VIDEO_FORMAT.height * SAFE_AREA.topFraction),
    bottom: Math.round(VIDEO_FORMAT.height * SAFE_AREA.bottomFraction),
  };
}

/** Kept in step with the caption limit: both answer "how wide is a phone?" */
export const VISUAL_MAX_LINES = MAX_BODY_LINES;
export const VISUAL_CHARS_PER_LINE = BODY_CHARS_PER_LINE;
export const VISUAL_MAX_SENTENCES = MAX_SENTENCES;
