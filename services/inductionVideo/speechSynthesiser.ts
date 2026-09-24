/**
 * Turning approved narration into speech.
 *
 * ── AN INTERFACE, NOT A VENDOR ────────────────────────────────────────────
 *
 * The pipeline talks to a SpeechSynthesiser. Azure Speech is one implementation
 * and the stub used by the test suites is another, which is what lets the
 * narration job be exercised end to end without spending a penny or needing a
 * network. The same shape the AI provider already uses.
 *
 * ── THE TEXT IS DATA, NOT MARKUP ──────────────────────────────────────────
 *
 * Narration is typed by a manager into a textarea. It reaches an XML document,
 * so it is ESCAPED before anything else happens: a manager who writes
 * "scaffold < 2m" must get a sentence about scaffolding, and a manager who
 * pastes a stray tag must not be able to change the voice, the rate, or have
 * the service fetch anything. Pacing marks are inserted only after escaping,
 * so they are the only markup in the document that this code did not write.
 *
 * ── DURATION IS MEASURED, NOT GUESSED ─────────────────────────────────────
 *
 * Captions and (in Phase 3) the video timeline are both cut to the audio, so a
 * wrong duration means subtitles that drift out of step with the voice. The
 * returned MP3 is parsed frame by frame and its true length reported. Where
 * that fails the caller is told the figure is an estimate rather than being
 * handed a plausible number with no provenance.
 */

/** The standard narrator, by the owner's decision. Overridable per deployment. */
export const DEFAULT_VOICE = 'en-GB-SoniaNeural';

/**
 * 24 kHz mono at 48 kbit/s: about 360 KB a minute.
 *
 * Speech, not music. A higher rate would triple what an operative downloads on
 * site data for no audible gain, and MP3 plays everywhere without a codec
 * question - which matters more here than a few kilobytes.
 */
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
export const AUDIO_CONTENT_TYPE = 'audio/mpeg';

/** Azure's own limit is 10 minutes of audio per request; a scene is under one. */
export const MAX_SYNTHESIS_CHARS = 3_000;

export interface SynthesisResult {
  audio: Buffer;
  contentType: string;
  /** Measured from the audio itself, or estimated when it could not be read. */
  durationMs: number;
  durationEstimated: boolean;
  /** Billable characters, as the provider counts them: the spoken text. */
  chars: number;
  voice: string;
}

export interface SpeechSynthesiser {
  /** For the audit trail and the usage row. */
  readonly provider: string;
  readonly voice: string;
  synthesise(text: string): Promise<SynthesisResult>;
}

/* ────────────────────────────── SSML ────────────────────────────────────── */

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The document sent to the service.
 *
 * SLIGHTLY SLOW, WITH A BREATH BETWEEN SENTENCES. A safety briefing read at
 * conversational pace is followed by nobody; the rate and the pauses are the
 * one place this pipeline shapes delivery rather than content. The breaks go in
 * AFTER escaping - see the module note.
 */
export function buildSsml(text: string, voice: string): string {
  const spoken = escapeXml(text.trim().replace(/\s+/g, ' '));
  const paced = spoken.replace(/([.!?])\s+/g, '$1<break time="350ms"/> ');
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">' +
    `<voice name="${escapeXml(voice)}">` +
    '<prosody rate="-5%">' +
    paced +
    '</prosody></voice></speak>'
  );
}

/* ──────────────────────── measuring the audio ───────────────────────────── */

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], //  MPEG 2.5
};

/**
 * The true length of an MP3, by walking its frames.
 *
 * Counting frames is exact for constant and variable bitrate alike, where
 * dividing the file size by a nominal bitrate is only ever right by luck. The
 * answer is used to cut captions, so "about right" is not good enough.
 *
 * Returns null when the bytes are not a readable MP3 - a wrong answer would be
 * worse than an admitted one.
 */
export function mp3DurationMs(buffer: Buffer): number | null {
  let i = skipId3(buffer);
  let samples = 0;
  let sampleRate = 0;
  let frames = 0;

  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) {
      // Not a frame header. Resynchronise a byte at a time; a tag or a stray
      // byte between frames must not end the count.
      i++;
      continue;
    }
    const versionBits = (buffer[i + 1] >> 3) & 0x03;
    const layerBits = (buffer[i + 1] >> 1) & 0x03;
    if (versionBits === 1 || layerBits !== 1) {
      i++;
      continue; // reserved version, or not Layer III
    }
    const rates = SAMPLE_RATES[versionBits];
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
    const rateIndex = (buffer[i + 2] >> 2) & 0x03;
    if (!rates || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) {
      i++;
      continue;
    }
    const mpeg1 = versionBits === 3;
    const bitrate = (mpeg1 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex] * 1000;
    const rate = rates[rateIndex];
    if (!bitrate || !rate) {
      i++;
      continue;
    }
    const perFrame = mpeg1 ? 1152 : 576;
    const padding = (buffer[i + 2] >> 1) & 0x01;
    const length = Math.floor((perFrame / 8) * (bitrate / rate)) + padding;
    if (length <= 4) {
      i++;
      continue;
    }
    samples += perFrame;
    sampleRate = rate;
    frames++;
    i += length;
  }

  if (frames === 0 || sampleRate === 0) return null;
  return Math.round((samples / sampleRate) * 1000);
}

/** ID3v2 tags sit in front of the first frame and carry a syncsafe length. */
function skipId3(buffer: Buffer): number {
  if (buffer.length < 10) return 0;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return 0;
  const size =
    (buffer[6] & 0x7f) * 0x200000 +
    (buffer[7] & 0x7f) * 0x4000 +
    (buffer[8] & 0x7f) * 0x80 +
    (buffer[9] & 0x7f);
  return Math.min(buffer.length, 10 + size);
}

/**
 * How long this text would take to say, when the audio cannot be measured.
 *
 * About 150 words a minute, which is the pace of a briefing read aloud rather
 * than an audiobook. Only ever a fallback, and always reported as one.
 */
export function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1_000, Math.round((words / 150) * 60_000));
}

/* ─────────────────────────── Azure Speech ───────────────────────────────── */

export class AzureSpeechSynthesiser implements SpeechSynthesiser {
  readonly provider = 'azure-speech';
  readonly voice: string;
  private readonly endpoint: string;
  private readonly key: string;

  constructor(opts: { region?: string; endpoint?: string; key: string; voice?: string }) {
    this.key = opts.key;
    this.voice = opts.voice || DEFAULT_VOICE;
    this.endpoint =
      opts.endpoint ||
      `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }

  async synthesise(text: string): Promise<SynthesisResult> {
    const spoken = text.trim().replace(/\s+/g, ' ');
    if (!spoken) throw new Error('There is nothing to say.');
    if (spoken.length > MAX_SYNTHESIS_CHARS) {
      throw new Error(`A scene of ${spoken.length} characters is too long to synthesise.`);
    }

    const audio = await this.post(buildSsml(spoken, this.voice));
    const measured = mp3DurationMs(audio);

    return {
      audio,
      contentType: AUDIO_CONTENT_TYPE,
      durationMs: measured ?? estimateDurationMs(spoken),
      durationEstimated: measured === null,
      chars: spoken.length,
      voice: this.voice,
    };
  }

  /**
   * One scene's request, retried on the failures that pass.
   *
   * A 429 or a 503 is the service asking us to wait, and a whole video's
   * narration should not be abandoned - and its already-spent characters
   * wasted - because one scene arrived during a busy second. A 400 or a 401 is
   * our fault and is not retried: repeating a malformed request only delays the
   * manager seeing why it failed.
   */
  private async post(ssml: string, attempt = 1): Promise<Buffer> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'SiteComply',
      },
      body: ssml,
    });

    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) throw new Error('The speech service returned no audio.');
      return bytes;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1_500));
      return this.post(ssml, attempt + 1);
    }
    /*
     * The body may quote the SSML back, which contains the narration. Only the
     * status and a short reason are kept: a job row is read by anyone who can
     * see the video, and an error is not the place to duplicate site content.
     */
    throw new Error(`The speech service refused the request (${res.status}).`);
  }
}

/**
 * The synthesiser this deployment uses, or null when speech is not configured.
 *
 * NULL RATHER THAN A THROW AT IMPORT. The rest of the platform must boot and
 * run with no speech resource at all - the same property the documents storage
 * and the AI provider already have. A manager then meets "narration is not
 * configured on this deployment", which is true, instead of a 500.
 */
export function resolveSpeechSynthesiser(): SpeechSynthesiser | null {
  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  const endpoint = process.env.SPEECH_ENDPOINT;
  if (!key || (!region && !endpoint)) return null;
  return new AzureSpeechSynthesiser({
    key,
    region,
    endpoint,
    voice: process.env.SPEECH_VOICE || DEFAULT_VOICE,
  });
}

/** Throws with the name of what is missing. For scripts and one-off tools. */
export function requireSpeechSynthesiser(): SpeechSynthesiser {
  const synth = resolveSpeechSynthesiser();
  if (!synth) {
    throw new Error(
      'Speech is not configured. Set SPEECH_KEY and SPEECH_REGION ' +
        '(or SPEECH_ENDPOINT) in the Azure configuration.',
    );
  }
  return synth;
}

/**
 * Roughly what a narration cost, in pence.
 *
 * Azure's neural voices are about $15 per million characters; 1,200 pence per
 * million is that at a round exchange rate. Indicative, like the script's own
 * estimate: it exists to show a site costing ten times the others, not to
 * invoice anybody.
 */
export function estimateNarrationPence(chars: number): number {
  const pencePerMillion = Number(process.env.SPEECH_PENCE_PER_MILLION || 1_200);
  return Math.max(0, Math.round((chars * pencePerMillion) / 1_000_000));
}
