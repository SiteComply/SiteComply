import {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_MIN_MS,
} from '@/services/inductionVideo/videoFormat';

/**
 * Captions and the written transcript, built from the narration and the measured
 * audio. No service, no model, no cost.
 *
 * ── WHY THIS IS NOT OPTIONAL ──────────────────────────────────────────────
 *
 * A site induction is the one briefing every operative must receive, and a
 * spoken-only induction excludes the operative who cannot hear it and the
 * operative whose English is better read than heard. Both are on British sites
 * in numbers. Captions cost nothing here because the exact words and the exact
 * audio lengths are already known - so there is no case for leaving them out.
 *
 * The transcript serves a second purpose: it is the readable record of what an
 * operative was told, which is what an investigation asks for. A video is poor
 * evidence on paper.
 *
 * ── CUES ARE CUT TO THE AUDIO, NOT TO A GUESS ─────────────────────────────
 *
 * Each scene's real duration is divided across its caption chunks in proportion
 * to how much there is to read. Cues never overlap and never run past their
 * scene, so the words on screen are the words being spoken - a caption track
 * that drifts is worse than none, because it is trusted.
 */

export interface CaptionScene {
  heading: string;
  narration: string;
  /** Measured length of this scene's audio. */
  durationMs: number;
}

export interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  /** Wrapped for the screen; joined with newlines in the file. */
  lines: string[];
  text: string;
}

/** HH:MM:SS.mmm, as WebVTT requires. */
export function formatVttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1_000);
  const milli = total % 1_000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

/** "3 minutes 24 seconds" — for the transcript header and the manager's panel. */
export function formatRunningTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} second${s === 1 ? '' : 's'}`;
  if (s === 0) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`;
}

/**
 * Split narration into things that fit on screen.
 *
 * Sentences first, because a caption that breaks mid-thought is read twice. A
 * sentence too long for one cue is split at its own punctuation, and only then
 * between words - never mid-word, and never by dropping anything.
 */
export function splitForCaptions(narration: string, max = CAPTION_MAX_CHARS): string[] {
  const text = narration.trim().replace(/\s+/g, ' ');
  if (!text) return [];

  const sentences = text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= max) {
      // Join a short sentence onto the previous chunk while it still fits: two
      // three-word cues in a row flicker.
      const last = chunks[chunks.length - 1];
      if (last && last.length + 1 + sentence.length <= max) {
        chunks[chunks.length - 1] = `${last} ${sentence}`;
      } else {
        chunks.push(sentence);
      }
      continue;
    }
    for (const part of splitLongSentence(sentence, max)) chunks.push(part);
  }
  return chunks;
}

function splitLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let current = '';
  // Clause boundaries first; the reader's eye already pauses there.
  const clauses = sentence.split(/(?<=[,;:])\s+/);
  for (const clause of clauses) {
    for (const word of clause.split(' ')) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= max) {
        current = `${current} ${word}`;
      } else {
        pieces.push(current);
        current = word;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Wrap a cue for the screen.
 *
 * ONE LINE IF IT FITS. An earlier version balanced every cue across two lines,
 * which turned "Welcome to the site." into "Welcome to / the site." - a caption
 * that draws the eye twice for no reason. Short cues stay on one line; a cue
 * that needs two gets them BALANCED, because a full line above a two-word line
 * is harder to scan on a phone than two even ones.
 */
export function wrapCaption(text: string, maxChars = CAPTION_MAX_CHARS): string[] {
  const perLine = Math.ceil(maxChars / CAPTION_MAX_LINES);
  const words = text.split(' ');
  if (text.length <= perLine || words.length === 1) return [text];

  if (text.length <= perLine * CAPTION_MAX_LINES) {
    // The word boundary closest to the middle, with neither line overflowing.
    const half = text.length / 2;
    let best: [string, string] | null = null;
    let bestGap = Infinity;
    for (let i = 1; i < words.length; i++) {
      const first = words.slice(0, i).join(' ');
      const second = words.slice(i).join(' ');
      if (first.length > perLine || second.length > perLine) continue;
      const gap = Math.abs(first.length - half);
      if (gap < bestGap) {
        bestGap = gap;
        best = [first, second];
      }
    }
    if (best) return best;
  }

  // Longer than two lines will hold - a merged short cue, usually. Fill greedily
  // rather than dropping any of it.
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= perLine) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The cue list for a whole induction.
 *
 * A scene with no measured duration is skipped rather than given a length this
 * code invented; the narration job never produces one, and if it somehow did,
 * silent captions are safer than wrong ones.
 */
export function buildCues(scenes: CaptionScene[]): Cue[] {
  const cues: Cue[] = [];
  let offset = 0;
  let index = 0;

  for (const scene of scenes) {
    const duration = Math.max(0, Math.round(scene.durationMs || 0));
    if (duration === 0) continue;
    const chunks = mergeShortChunks(splitForCaptions(scene.narration), duration);
    if (chunks.length === 0) {
      offset += duration;
      continue;
    }

    const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let start = offset;
    chunks.forEach((chunk, i) => {
      const last = i === chunks.length - 1;
      // The last cue takes the remainder, so rounding can never leave a gap or
      // push a cue past the end of its own scene.
      const end = last
        ? offset + duration
        : Math.min(offset + duration, start + Math.round((chunk.length / totalChars) * duration));
      index += 1;
      cues.push({
        index,
        startMs: start,
        endMs: Math.max(end, start + 1),
        lines: wrapCaption(chunk),
        text: chunk,
      });
      start = Math.max(start + 1, end);
    });
    offset += duration;
  }
  return cues;
}

/**
 * Fold away cues that would flash past.
 *
 * A trailing "Thank you." of ten characters gets three-quarters of a second of
 * a scene's time, which nobody reads. It is merged into the cue before it even
 * though the result is longer than one screen wants: showing all the words for
 * long enough beats showing them tidily and too briefly.
 */
function mergeShortChunks(chunks: string[], durationMs: number): string[] {
  if (chunks.length <= 1) return chunks;
  const out = [...chunks];
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    const totalChars = out.reduce((n, c) => n + c.length, 0) || 1;
    for (let i = 0; i < out.length; i++) {
      const share = (out[i].length / totalChars) * durationMs;
      if (share >= CAPTION_MIN_MS) continue;
      const mergeInto = i === 0 ? 1 : i - 1;
      const [a, b] = i === 0 ? [out[0], out[1]] : [out[mergeInto], out[i]];
      out.splice(Math.min(i, mergeInto), 2, `${a} ${b}`);
      changed = true;
      break;
    }
  }
  return out;
}

/** The WebVTT file. */
export function buildVtt(scenes: CaptionScene[]): string {
  const cues = buildCues(scenes);
  const body = cues
    .map(
      (c) =>
        `${c.index}\n${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${c.lines.join('\n')}`,
    )
    .join('\n\n');
  // A WEBVTT header and a blank line, then cues: a file without the header is
  // silently ignored by every player.
  return `WEBVTT\n\n${body}\n`;
}

export interface TranscriptMeta {
  siteName: string;
  version: number;
  /** Already formatted by the caller, which keeps this module free of a clock. */
  narratedOn?: string;
  voice?: string;
  totalMs: number;
}

/** The plain-text record of what the induction says. */
export function buildTranscript(meta: TranscriptMeta, scenes: CaptionScene[]): string {
  const head = [
    `SITE INDUCTION — ${meta.siteName}`,
    `Version ${meta.version}`,
    meta.narratedOn ? `Narrated ${meta.narratedOn}` : null,
    meta.voice ? `Voice ${meta.voice}` : null,
    `Running time ${formatRunningTime(meta.totalMs)}`,
    '',
    'This is the spoken content of the site induction video, in full.',
    '',
  ].filter((l) => l !== null) as string[];

  const body = scenes.map((s, i) => {
    const words = [`${i + 1}. ${s.heading.toUpperCase()}`, ''];
    words.push(s.narration.trim());
    return words.join('\n');
  });

  return `${head.join('\n')}${body.join('\n\n')}\n`;
}
