import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { VIDEO_FORMAT } from '@/services/inductionVideo/videoFormat';

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

/** Milliseconds, read from the container rather than guessed from the bitrate. */
async function probeDurationMs(bin: string, file: string, cwd: string): Promise<number> {
  /*
   * ffprobe is a separate binary and the vendored build may not include it, so the
   * duration is read from ffmpeg's own report of the file it just wrote. Parsing
   * stderr is unlovely but it is the one thing guaranteed to be present.
   */
  const { stderr } = await run(bin, ['-hide_banner', '-nostdin', '-i', file], cwd, 60_000).catch(
    (e: Error) => ({ stdout: '', stderr: e.message }),
  );
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
  if (!m) return 0;
  const [, h, min, sec, frac] = m;
  return (
    Number(h) * 3_600_000 +
    Number(min) * 60_000 +
    Number(sec) * 1_000 +
    Number(frac.padEnd(3, '0').slice(0, 3))
  );
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
export async function normaliseToSpec(source: Buffer, fileName: string): Promise<{
  output: Buffer;
  durationMs: number;
}> {
  const bin = executablePath();
  await ensureExecutable(bin);
  const { width, height, fps } = VIDEO_FORMAT;
  const work = await mkdtemp(join(tmpdir(), 'lib-norm-'));
  try {
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.replace(/[^a-zA-Z0-9]/g, '') : 'mp4';
    const input = `source.${ext || 'mp4'}`;
    await writeFile(join(work, input), source);

    await run(
      bin,
      [
        '-hide_banner', '-nostdin', '-y',
        '-i', input,
        /*
         * Silent audio, used only if the upload has no audio stream. `-shortest`
         * below stops it extending the segment.
         */
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${fps},setsar=1[v]`,
        '-map', '[v]',
        // The upload's own audio when it has any, the silence otherwise.
        '-map', '0:a?',
        '-map', '1:a',
        '-shortest',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-g', String(fps * 2),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
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
    const durationMs = await probeDurationMs(bin, 'segment.mp4', work);
    return { output: await readFile(out), durationMs };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
