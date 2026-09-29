import { spawn } from 'node:child_process';
import { deprioritiseEncode } from '@/services/inductionVideo/childPriority';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandMotionFile } from '@/services/inductionVideo/brandMotion';
import { buildTimeline } from '@/services/inductionVideo/timeline';
import { VIDEO_FORMAT, audioEncodeArgs } from '@/services/inductionVideo/videoFormat';
import { sceneVisual, type SceneVisual } from '@/services/inductionVideo/sceneVisual';
import { sceneAss } from '@/services/inductionVideo/assDocument';
import type {
  RenderOutput,
  RenderRequest,
  VideoRenderer,
} from '@/services/inductionVideo/videoRenderer';

/**
 * Rendering the induction ourselves, with ffmpeg.
 *
 * ── SCENE BY SCENE, THEN JOINED ───────────────────────────────────────────
 *
 * Each scene is encoded on its own - a coloured frame, its text layer, the brand
 * mark, its own narration - and the finished scenes are concatenated by stream
 * copy. One enormous filter graph would be faster to write and far worse to
 * live with: a single bad character in scene nine would fail the whole render
 * with a message pointing at a filter chain, whereas here the failure names the
 * scene, and every finished scene is a file a person can open and look at.
 *
 * The join re-encodes nothing. Every scene is produced with identical codec
 * settings for exactly that reason, so the last step is a copy and costs seconds
 * rather than minutes.
 *
 * ── WHY THE WORK HAPPENS IN A TEMPORARY DIRECTORY, WITH BARE FILENAMES ────
 *
 * ffmpeg filter arguments are colon-and-comma separated, so a path inside a
 * filter has to be escaped twice over - and an absolute path on a Windows
 * developer's machine cannot be escaped into working at all. Running with the
 * work directory as the process's own cwd means every path in a filter is a
 * bare filename with nothing in it that needs escaping.
 *
 * ── AND WHY IT IS NOT THE DEFAULT IN PRODUCTION ───────────────────────────
 *
 * This encodes 1080x1920 video on the machine it runs on. On the single small
 * App Service instance that also serves every request, a four-minute induction
 * is minutes of contended CPU. It is the right engine for validation, for a
 * deployment that will not add a processor, and for a dedicated worker; it is a
 * deliberate operational choice, not a default. Hence FFMPEG_PATH: absent, this
 * engine does not exist.
 */

const SCENE_PREFIX = 'scene';
/** veryfast keeps a four-minute induction inside a few minutes of CPU. */
const PRESET = process.env.FFMPEG_PRESET || 'veryfast';
const CRF = process.env.FFMPEG_CRF || '23';

export function ffmpegBinary(): string | null {
  const configured = process.env.FFMPEG_PATH;
  if (configured && existsSync(configured)) return executable(configured) ? configured : null;
  // A conventional location for a userland install; anything else must be named.
  for (const candidate of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(candidate) && executable(candidate)) return candidate;
  }
  return null;
}

/**
 * Is this file runnable — and if not, can it be made so?
 *
 * A BINARY SHIPPED INSIDE A DEPLOYMENT ARRIVES WITHOUT ITS EXECUTE BIT. Zip
 * deployment does not reliably carry unix permissions, so a vendored ffmpeg
 * lands as a 78 MB file the platform is not allowed to run, and the only symptom
 * is EACCES from deep inside a render job. Repairing it here costs one syscall
 * and turns a confusing failure into no failure at all; if the chmod is refused
 * too, the engine reports itself as unavailable rather than pretending.
 */
function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    try {
      chmodSync(path, 0o755);
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export function ffprobeBinary(bin: string): string {
  return bin.replace(/ffmpeg$/, 'ffprobe');
}

/** The brand mark placed in the corner of every frame. */
function logoPath(): string | null {
  const candidate =
    process.env.INDUCTION_VIDEO_LOGO || join(process.cwd(), 'public', 'sitecomply-logo.png');
  return existsSync(candidate) ? candidate : null;
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    // The page watching this render is a person waiting; the render is not.
    deprioritiseEncode(child.pid);
    let stdout = '';
    let stderr = '';
    // KEPT, BUT CAPPED. ffmpeg's log is where the reason for a failure lives, and
    // it is also several hundred lines of progress per scene.
    child.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-4_000);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-4_000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        // The last lines of the log, not all of it: enough to see the cause on a
        // job row without pasting a filter graph into the audit trail.
        const tail = stderr.trim().split('\n').slice(-4).join(' · ');
        reject(new Error(`ffmpeg exited ${code}: ${tail}`));
      }
    });
  });
}

export class FfmpegVideoRenderer implements VideoRenderer {
  readonly engine = 'ffmpeg';
  /** Our own CPU, so nothing per minute. The instance is already paid for. */
  readonly pencePerMinute = 0;

  constructor(
    private readonly bin: string,
    private readonly opts: { timeoutMsPerScene?: number } = {},
  ) {}

  async render(request: RenderRequest): Promise<RenderOutput> {
    if (request.scenes.length === 0) throw new Error('There are no scenes to render.');
    const started = Date.now();
    const work = await mkdtemp(join(tmpdir(), 'sitecomply-render-'));
    const logo = logoPath();

    try {
      if (logo) await writeFile(join(work, 'logo.png'), await readFile(logo));

      /*
       * ── THE RUNNING ORDER COMES FROM timeline.ts, NOT FROM HERE ─────────
       *
       * Branded clips are spliced in between scenes, and the CAPTION BUILDER has
       * already timed the subtitles against the same running order during narration.
       * If this function decided the order independently the two would diverge and
       * every subtitle after the first bumper would be early - a fault that gets
       * worse through the video and is easy to ship. One pure function, both callers.
       */
      const timeline = buildTimeline(
        request.scenes.map((sc) => ({ sceneType: sc.sceneType, durationMs: sc.durationMs })),
      );

      const parts: string[] = [];
      for (const part of timeline) {
        if (part.kind === 'BRAND') {
          /*
           * A PRECOMPUTED CLIP, copied in. It was built to this pipeline's exact spec
           * by scripts/build_brand_motion.sh, so it needs no encode at all: this is
           * the whole reason an induction can carry real motion on a shared core.
           */
          const file = brandMotionFile(part.assetKey);
          const target = `brand-${part.assetKey}.mp4`;
          await writeFile(join(work, target), await readFile(file));
          parts.push(target);
          continue;
        }
        const index = part.index;
        const scene = request.scenes[index];
        const stem = `${SCENE_PREFIX}-${String(index).padStart(2, '0')}`;

        /*
         * A LIBRARY SEGMENT IS ALREADY A FINISHED SCENE. It was transcoded to this
         * pipeline's exact spec when it was uploaded, so it goes into the list as it
         * is - no frame to draw, no audio to lay over it, no second encode. That is
         * what keeps the join a stream copy now that inductions contain footage.
         */
        if (scene.segment) {
          if (scene.segment.length === 0) {
            throw new Error(`“${scene.heading}” has an empty video segment.`);
          }
          await writeFile(join(work, `${stem}.mp4`), scene.segment);
          parts.push(`${stem}.mp4`);
          continue;
        }
        if (!scene.audio || scene.audio.length === 0) {
          throw new Error(`“${scene.heading}” has no audio; the render would be silent.`);
        }
        const visual = sceneVisual(scene);
        await writeFile(join(work, `${stem}.mp3`), scene.audio);
        await writeFile(
          join(work, `${stem}.ass`),
          sceneAss(visual, scene.durationMs, `${request.siteName} · induction v${request.version}`),
          'utf8',
        );
        await run(this.bin, this.sceneArgs(stem, visual, Boolean(logo), scene.durationMs), work,
          this.opts.timeoutMsPerScene ?? 180_000);
        parts.push(`${stem}.mp4`);
      }

      /*
       * A list file, not a concat filter: the demuxer joins by stream copy, so
       * the join is seconds of I/O instead of a second full encode. `-safe 0`
       * because the entries are relative names, which the demuxer rejects by
       * default as a precaution against a list pointing anywhere on disk.
       */
      await writeFile(
        join(work, 'parts.txt'),
        parts.map((p) => `file '${p}'`).join('\n'),
        'utf8',
      );
      await run(
        this.bin,
        [
          '-hide_banner', '-nostdin', '-y',
          '-f', 'concat', '-safe', '0', '-i', 'parts.txt',
          '-c', 'copy',
          // So a player can start before the whole file has arrived - an
          // operative on site data, not office broadband.
          '-movflags', '+faststart',
          'induction.mp4',
        ],
        work,
        120_000,
      );

      const mp4 = await readFile(join(work, 'induction.mp4'));
      /*
       * MEASURED IF WE CAN, SUMMED IF WE CANNOT.
       *
       * ffprobe ships beside ffmpeg in most builds but not all, and a duration of
       * zero is not a cosmetic failure here: an operative's progress is judged
       * against it, so a zero would mean nobody could ever complete the
       * induction. The sum of the scenes' measured audio is right to within the
       * frame rounding at each cut, which is a few milliseconds.
       */
      const probed = await this.probeDurationMs(work, 'induction.mp4');
      const durationMs =
        probed > 0 ? probed : request.scenes.reduce((n, s) => n + s.durationMs, 0);
      return {
        mp4,
        durationMs,
        engine: this.engine,
        renderSeconds: Math.round((Date.now() - started) / 1000),
      };
    } finally {
      // The work directory holds narration audio: removed whether or not the
      // render worked, not left in /tmp for whatever comes along next.
      await rm(work, { recursive: true, force: true });
    }
  }

  /** One scene: colour, text layer, brand mark, its own audio. */
  private sceneArgs(
    stem: string,
    visual: SceneVisual,
    withLogo: boolean,
    durationMs: number,
  ): string[] {
    const { width, height, fps } = VIDEO_FORMAT;
    const background = visual.palette.background;
    /*
     * The colour source is INFINITE and `-shortest` ends the output with the
     * audio, so the frame is held for exactly as long as the voice speaks. Giving
     * the source a duration instead would round to whole frames and drift a few
     * milliseconds per scene - which over a dozen scenes is a visible gap between
     * the last word and the cut.
     */
    /*
     * ── THE ACCENT, AND WHY IT IS drawbox ─────────────────────────────────
     *
     * A flat shape costs the encoder nothing measurable, and it is what makes a
     * family recognisable before a word has been read: an alert bar on emergency
     * information, a diagonal-feeling stripe band on hazards, a brand rule on the
     * standards. `drawtext` is not in this build, so anything with words in it goes
     * through ASS; anything that is just a shape goes here.
     */
    const accent = accentFilter(visual, width, height);

    /*
     * ── FADES AT THE EDGES, NOT CROSS-FADES BETWEEN ───────────────────────
     *
     * The induction is assembled with the concat demuxer and `-c copy`. A true
     * cross-fade needs both neighbours decoded and re-encoded together, which would
     * re-encode the whole video and multiply the cost by its length - unaffordable on
     * a B1. Fading each part in and out at its own edges is free, because this encode
     * is happening anyway, and where two faded parts meet a viewer sees a dip rather
     * than a hard cut.
     */
    const edge = Math.min(0.35, Math.max(0.12, (durationMs / 1000) * 0.08));
    const outAt = Math.max(0, durationMs / 1000 - edge);
    const fades = `,fade=t=in:st=0:d=${edge.toFixed(2)},fade=t=out:st=${outAt.toFixed(2)}:d=${edge.toFixed(2)}`;

    const filter = withLogo
      ? `[0:v]${accent}ass=${stem}.ass${fades}[t];[2:v]scale=${Math.round(width * 0.17)}:-1[lg];[t][lg]overlay=W-w-${Math.round(width * 0.055)}:${Math.round(height * 0.045)}:format=auto[v]`
      : `[0:v]${accent}ass=${stem}.ass${fades}[v]`;

    return [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'lavfi', '-i', `color=c=${background}:s=${width}x${height}:r=${fps}`,
      '-i', `${stem}.mp3`,
      ...(withLogo ? ['-i', 'logo.png'] : []),
      '-filter_complex', filter,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
      // The frame never changes; x264 is told so.
      '-tune', 'stillimage',
      /*
       * A keyframe every two seconds. At ten frames a second the default
       * interval is twenty-five SECONDS, and a player can only seek to a
       * keyframe - an operative dragging the scrubber would jump in
       * twenty-five-second steps and conclude the video was broken.
       */
      '-g', String(VIDEO_FORMAT.fps * 2),
      // yuv420p, or the file will not play on iOS at all.
      '-pix_fmt', 'yuv420p',
      /*
       * The SHARED audio spec, not this file's own. Azure speech returns
       * `...-mono-mp3`, so without an explicit channel count a generated scene
       * inherited ONE channel while library footage was forced to two, and the
       * `-c copy` join then mislabelled whichever came second.
       */
      ...audioEncodeArgs(),
      '-shortest',
      `${stem}.mp4`,
    ];
  }

  /** Returns 0 when it cannot measure, so the caller can fall back to the sum. */
  private async probeDurationMs(cwd: string, file: string): Promise<number> {
    const probe = ffprobeBinary(this.bin);
    if (!existsSync(probe)) return 0;
    try {
      const { stdout } = await run(
        probe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        cwd,
        30_000,
      );
      const seconds = Number(stdout.trim());
      return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
    } catch {
      // A render that worked must not be thrown away because measuring it did not.
      return 0;
    }
  }
}

/**
 * The flat graphic behind the text, as a filter fragment ending in a comma (or empty).
 *
 * Deliberately restrained. The point is to make a SECTION recognisable at a glance,
 * not to decorate: an operative at a gate reading their phone in daylight benefits
 * from a strong colour band far more than from anything intricate.
 */
/**
 * Where an accent sits: above the heading's anchor, below the brand mark.
 *
 * SAFE_AREA.topFraction (0.12) puts the heading at 230px; the mark sits at about
 * 0.045 and is roughly 55px tall, so it clears by 141px. 178 is between the two.
 */
const ACCENT_Y = Math.round(VIDEO_FORMAT.height * 0.093);

function accentFilter(
  visual: { accent: string | null; palette: { rule: string; heading: string } },
  width: number,
  height: number,
): string {
  switch (visual.accent) {
    /*
     * ── WHY EVERY ACCENT SITS ABOVE THE HEADING ───────────────────────────
     *
     * ACCENT_Y is above the safe-area line the heading starts on, and below the
     * brand mark in the corner. The first version put these at 0.165 of the frame
     * height, which is 317px — and the heading is top-anchored at 230px in a 72pt
     * face, so it occupies roughly 230 to 320. The stripes ran straight THROUGH the
     * words. Every automated check passed: the file rendered, the duration was right,
     * the frame had content. It took looking at a frame to see it, which is the
     * argument for looking at frames.
     *
     * A two-line heading grows DOWNWARDS from the same anchor, so sitting above it is
     * the only position that is safe for every heading length.
     */
    case 'ALERT_BAR': {
      // A band across the full width: this scene is an instruction, not information.
      return `drawbox=x=0:y=${ACCENT_Y}:w=${width}:h=${Math.round(height * 0.009)}:color=${boxColour(visual.palette.rule)}:t=fill,`;
    }
    case 'HAZARD_STRIPE': {
      // Alternating marks reading as a hazard band. Far more legible at phone size
      // than a true diagonal, and it needs no second filter pass.
      const h = Math.round(height * 0.011);
      const seg = Math.round(width / 11);
      return [1, 3, 5, 7, 9]
        .map((i) => `drawbox=x=${i * seg}:y=${ACCENT_Y}:w=${seg}:h=${h}:color=${boxColour(visual.palette.rule)}:t=fill`)
        .join(',') + ',';
    }
    case 'BRAND_RULE': {
      // A short centred rule: the company speaking, not a warning.
      const w = Math.round(width * 0.18);
      return `drawbox=x=${Math.round((width - w) / 2)}:y=${ACCENT_Y}:w=${w}:h=${Math.round(height * 0.007)}:color=${boxColour(visual.palette.rule)}:t=fill,`;
    }
    default:
      return '';
  }
}

/** `#rrggbb` as ffmpeg wants it, with full opacity stated rather than assumed. */
function boxColour(hex: string): string {
  return `${hex.startsWith('#') ? '0x' + hex.slice(1) : hex}@1.0`;
}
