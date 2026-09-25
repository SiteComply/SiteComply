import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { AUDIO_FORMAT, VIDEO_FORMAT, audioEncodeArgs } from '@/services/inductionVideo/videoFormat';

/**
 * TRANSCODING AN UPLOAD TO THE PIPELINE'S EXACT OUTPUT SPEC.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 *
 * The renderer joins finished scenes with ffmpeg's concat DEMUXER and `-c copy`:
 * a stream copy, seconds of I/O instead of a second full encode. That is what
 * makes rendering survivable on a small instance, and it is also unforgiving —
 * every segment must share codec, resolution, pixel format, framerate, timebase
 * and audio layout, or the join produces a file that stutters, desynchronises or
 * refuses to play.
 *
 * Nothing anybody uploads will match. So an upload is normalised ONCE, here, and
 * the render stays a copy. Transcoding at render time instead would put a full
 * encode of every library segment into every site's render, on shared CPU.
 *
 * ── THE SPEC IS NOT REPEATED, IT IS IMPORTED ──────────────────────────────
 *
 * From videoFormat.ts, the same numbers the renderer and the caption builder use.
 * Two copies of an output spec is exactly the bug this whole approach is exposed
 * to: they would agree until somebody changed one.
 *
 * ── WHAT IT DOES TO THE PICTURE ───────────────────────────────────────────
 *
 * Scales to fit inside 1080×1920 preserving aspect, then pads to fill. A
 * landscape company introduction becomes a letterboxed portrait frame rather than
 * being cropped: cropping decides, silently and wrongly, that the sides of
 * somebody's footage did not matter. Padding is honest about the shape mismatch
 * and is the operator's cue to supply portrait footage.
 *
 * Audio is forced to stereo 44.1 kHz AAC even when the source is silent, because
 * a segment with no audio stream at all cannot be concatenated with segments that
 * have one.
 */

export interface NormaliseResult {
  bytes: number;
  durationMs: number;
}

function executablePath(): string {
  return process.env.FFMPEG_PATH ?? 'ffmpeg';
}

/** The vendored binary loses its exec bit inside a deploy zip; restore it. */
async function ensureExecutable(bin: string): Promise<void> {
  if (bin === 'ffmpeg') return;
  try {
    await access(bin, constants.X_OK);
  } catch {
    try {
      await chmod(bin, 0o755);
    } catch {
      /* nothing else to try; the spawn below will report it */
    }
  }
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      // Capped: ffmpeg is chatty and a stuck encode would otherwise fill memory
      // with progress lines nobody reads.
      if (stderr.length < 20_000) stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(-1_500) || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * Milliseconds, read from the container rather than guessed from the bitrate -
 * and whether the file has an audio stream at all.
 *
 * The audio answer decides how many inputs the transcode gets. Mapping both the
 * source's audio AND a silent filler (`-map 0:a? -map 1:a`) is what produced
 * segments with TWO audio tracks for every real upload: the optional map matched,
 * the mandatory one was added anyway, and the concat silently kept one of them.
 */
async function probeSource(bin: string, file: string, cwd: string): Promise<{
  durationMs: number;
  hasAudio: boolean;
}> {
  /*
   * ffprobe is a separate binary and the vendored build may not include it, so the
   * duration is read from ffmpeg's own report of the file it just wrote. Parsing
   * stderr is unlovely but it is the one thing guaranteed to be present.
   */
  const { stderr } = await run(bin, ['-hide_banner', '-nostdin', '-i', file], cwd, 60_000).catch(
    (e: Error) => ({ stdout: '', stderr: e.message }),
  );
  // Only a stream OF THE INPUT counts. `Stream #0:` is the file being probed;
  // matching a bare "Audio:" would also match an input ffmpeg itself added.
  const hasAudio = /Stream #0:\d+.*: Audio:/.test(stderr);
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
  if (!m) return { durationMs: 0, hasAudio };
  const [, h, min, sec, frac] = m;
  return {
    durationMs:
      Number(h) * 3_600_000 +
      Number(min) * 60_000 +
      Number(sec) * 1_000 +
      Number(frac.padEnd(3, '0').slice(0, 3)),
    hasAudio,
  };
}

export function normalisingConfigured(): boolean {
  return Boolean(process.env.FFMPEG_PATH);
}

/**
 * Transcode `source` to the pipeline spec and return the bytes plus the duration.
 *
 * The caller uploads the result; this function touches no storage, so it can be
 * driven from a test with a local file.
 */
export async function normaliseToSpec<T>(
  /**
   * Either the bytes, or a function that writes the source to a path this gives
   * it. The second form keeps a 300 MB upload out of the Node heap entirely: the
   * caller streams storage straight to disk, ffmpeg reads the file, and the result
   * is streamed back without ever being a Buffer.
   */
  source: Buffer | ((destination: string) => Promise<boolean>),
  fileName: string,
  /**
   * Called with the finished segment while the working directory still exists.
   * Cleanup stays in this function's `finally`, so no caller can leak a temp dir
   * holding a copy of a video.
   */
  consume: (result: { outputPath: string; durationMs: number }) => Promise<T>,
): Promise<T> {
  const bin = executablePath();
  await ensureExecutable(bin);
  const { width, height, fps } = VIDEO_FORMAT;
  const work = await mkdtemp(join(tmpdir(), 'lib-norm-'));
  try {
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.replace(/[^a-zA-Z0-9]/g, '') : 'mp4';
    const input = `source.${ext || 'mp4'}`;
    if (typeof source === 'function') {
      const got = await source(join(work, input));
      if (!got) throw new Error('the uploaded file could not be read back from storage');
    } else {
      await writeFile(join(work, input), source);
    }

    /*
     * EXACTLY ONE AUDIO STREAM, decided before the encode rather than by two maps
     * racing each other. A silent filler is added as a second INPUT only when the
     * upload genuinely has no audio; when it does, there is no filler to map and
     * no `-shortest` needed to hold it back.
     */
    const probe = await probeSource(bin, input, work);
    const silentFiller = [
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=${AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono'}` +
        `:sample_rate=${AUDIO_FORMAT.sampleRate}`,
    ];
    await run(
      bin,
      [
        '-hide_banner', '-nostdin', '-y',
        '-i', input,
        ...(probe.hasAudio ? [] : silentFiller),
        '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${fps},setsar=1[v]`,
        '-map', '[v]',
        ...(probe.hasAudio ? ['-map', '0:a:0'] : ['-map', '1:a', '-shortest']),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-g', String(fps * 2),
        '-pix_fmt', 'yuv420p',
        ...audioEncodeArgs(),
        '-movflags', '+faststart',
        'segment.mp4',
      ],
      work,
      // Real footage on a small instance: minutes, not seconds.
      Number(process.env.LIBRARY_NORMALISE_TIMEOUT_MS ?? 15 * 60 * 1000),
    );

    const out = join(work, 'segment.mp4');
    const info = await stat(out);
    if (info.size === 0) throw new Error('the transcode produced an empty file');
    const durationMs = (await probeSource(bin, 'segment.mp4', work)).durationMs;
    return await consume({ outputPath: out, durationMs });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
