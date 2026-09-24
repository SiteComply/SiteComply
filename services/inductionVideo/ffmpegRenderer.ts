import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VIDEO_FORMAT } from '@/services/inductionVideo/videoFormat';
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

      const parts: string[] = [];
      for (const [index, scene] of request.scenes.entries()) {
        if (!scene.audio || scene.audio.length === 0) {
          throw new Error(`“${scene.heading}” has no audio; the render would be silent.`);
        }
        const stem = `${SCENE_PREFIX}-${String(index).padStart(2, '0')}`;
        const visual = sceneVisual(scene);
        await writeFile(join(work, `${stem}.mp3`), scene.audio);
        await writeFile(
          join(work, `${stem}.ass`),
          sceneAss(visual, scene.durationMs, `${request.siteName} · induction v${request.version}`),
          'utf8',
        );
        await run(this.bin, this.sceneArgs(stem, visual, Boolean(logo)), work,
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
  private sceneArgs(stem: string, visual: SceneVisual, withLogo: boolean): string[] {
    const { width, height, fps } = VIDEO_FORMAT;
    const background = visual.palette.background;
    /*
     * The colour source is INFINITE and `-shortest` ends the output with the
     * audio, so the frame is held for exactly as long as the voice speaks. Giving
     * the source a duration instead would round to whole frames and drift a few
     * milliseconds per scene - which over a dozen scenes is a visible gap between
     * the last word and the cut.
     */
    const filter = withLogo
      ? `[0:v]ass=${stem}.ass[t];[2:v]scale=${Math.round(width * 0.17)}:-1[lg];[t][lg]overlay=W-w-${Math.round(width * 0.055)}:${Math.round(height * 0.045)}:format=auto[v]`
      : `[0:v]ass=${stem}.ass[v]`;

    return [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'lavfi', '-i', `color=c=${background}:s=${width}x${height}:r=${fps}`,
      '-i', `${stem}.mp3`,
      ...(withLogo ? ['-i', 'logo.png'] : []),
      '-filter_complex', filter,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
      // yuv420p, or the file will not play on iOS at all.
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
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
