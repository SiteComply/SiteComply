export {};
/**
 * THE AUDIO SPEC HOLDS ACROSS BOTH ENCODERS, PROVEN WITH REAL FFMPEG.
 *
 * An induction is joined with the concat demuxer and `-c copy`. That copy cannot
 * reconcile two different channel layouts: it writes the FIRST part's layout into
 * the track header and copies later parts' frames underneath it. The file then
 * claims one thing and contains another, ffmpeg's decoder plays it anyway, and a
 * stricter player is entitled not to.
 *
 * So this runs the ACTUAL normaliser and the ACTUAL renderer over real media and
 * inspects the bytes that come out - not the arguments they were built from.
 *
 * Run: FFMPEG_PATH=$PWD/vendor/ffmpeg/ffmpeg npx tsx scripts/library_audiospec_verify.ts
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const run = promisify(execFile);

const BIN = process.env.FFMPEG_PATH || `${process.cwd()}/vendor/ffmpeg/ffmpeg`;
let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

/** ffmpeg reports on stderr; -i alone exits non-zero by design. */
async function probe(file: string): Promise<string> {
  try {
    const { stderr } = await run(BIN, ['-hide_banner', '-i', file]);
    return stderr;
  } catch (e: unknown) {
    return String((e as { stderr?: string }).stderr ?? '');
  }
}
const audioLines = (s: string) => s.split('\n').filter((l) => /Stream #0:\d+.*: Audio:/.test(l));

async function main() {
  const { AUDIO_FORMAT } = await import('../services/inductionVideo/videoFormat');
  const { normaliseToSpec } = await import('../services/inductionVideo/libraryNormaliser');
  const { FfmpegVideoRenderer } = await import('../services/inductionVideo/ffmpegRenderer');
  const work = await mkdtemp(join(tmpdir(), 'audiospec-'));
  try {
    console.log('\nTHE SPEC IS SHARED, NOT RETYPED');
    const fmt = await import('../services/inductionVideo/videoFormat');
    chk('the audio spec names a channel count', AUDIO_FORMAT.channels === 2,
      `${AUDIO_FORMAT.channels} channels`);
    chk('both encoders can reach it', typeof fmt.audioEncodeArgs === 'function');
    chk('  and it sets -ac explicitly',
      fmt.audioEncodeArgs().includes('-ac'),
      'without it a generated scene silently inherits the narration mp3\'s mono');

    // A realistic upload: LANDSCAPE, 30fps, 48kHz STEREO - none of it to spec.
    console.log('\nA REAL UPLOAD, NONE OF IT TO SPEC');
    const upload = join(work, 'upload.mp4');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
      '-map', '0:v', '-map', '1:a', '-t', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', upload]);
    chk('the upload has audio of its own', audioLines(await probe(upload)).length === 1);

    // normaliseToSpec hands the finished file to a callback and cleans up after it,
    // so a 300 MB upload never becomes a Buffer. Copy it out to inspect it.
    const readFile = require('node:fs/promises').readFile;
    const copyFile = require('node:fs/promises').copyFile;
    const segPath = join(work, 'segment.mp4');
    const seg = await normaliseToSpec(
      await readFile(upload), 'upload.mp4',
      async ({ outputPath, durationMs }: { outputPath: string; durationMs: number }) => {
        await copyFile(outputPath, segPath);
        return { durationMs, output: await readFile(outputPath) };
      },
    ) as { durationMs: number; output: Buffer };
    const segInfo = await probe(segPath);
    console.log('\nTHE NORMALISER PRODUCES EXACTLY ONE AUDIO STREAM');
    chk('one audio stream, not two', audioLines(segInfo).length === 1,
      `${audioLines(segInfo).length} found — the old code mapped the source AND a silent filler`);
    chk('  at the spec\'s channel count',
      new RegExp(AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono').test(audioLines(segInfo)[0] ?? ''));
    chk('  and the spec\'s sample rate',
      (audioLines(segInfo)[0] ?? '').includes(`${AUDIO_FORMAT.sampleRate} Hz`));
    chk('the frame is the pipeline\'s portrait canvas', /1080x1920/.test(segInfo));
    chk('  letterboxed, not stretched', /DAR 9:16/.test(segInfo));
    chk('measured a real duration', seg.durationMs > 2500 && seg.durationMs < 3500,
      `${seg.durationMs}ms`);

    // A silent upload must still get an audio track, or the concat has nothing to copy.
    const silent = join(work, 'silent.mp4');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=640x480:r=24', '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', silent]);
    const silentPath = join(work, 'silentseg.mp4');
    await normaliseToSpec(
      await readFile(silent), 'silent.mp4',
      async ({ outputPath }: { outputPath: string }) => copyFile(outputPath, silentPath),
    );
    const silentInfo = await probe(silentPath);
    console.log('\nAN UPLOAD WITH NO SOUND STILL GETS A TRACK');
    chk('silent footage gains exactly one audio stream',
      audioLines(silentInfo).length === 1,
      'a part with no audio track at all would break the copy');
    chk('  matching the spec',
      new RegExp(AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono').test(audioLines(silentInfo)[0] ?? ''));

    console.log('\nTHE STREAMING FORM WORKS, NOT ONLY THE BUFFER FORM');
    let wroteTo = '';
    const streamed = await normaliseToSpec(
      async (destination: string) => { wroteTo = destination; await copyFile(upload, destination); return true; },
      'upload.mp4',
      async ({ durationMs }: { durationMs: number }) => durationMs,
    ) as number;
    chk('a source written straight to disk transcodes the same', streamed > 2500 && streamed < 3500,
      `${streamed}ms — this is the path production uses, so no copy of the video is ever a Buffer`);
    chk('  and it was handed a path inside the working directory', wroteTo.includes('lib-norm-'));
    const missing = await normaliseToSpec(
      async () => false, 'gone.mp4', async () => 'should not reach here',
    ).catch((e: Error) => e.message);
    chk('a source that cannot be fetched fails loudly',
      String(missing).includes('could not be read back from storage'),
      'a silent empty transcode would be worse than an error');

    /*
     * THE JOIN. Narration is mono mp3 - that is what Azure speech returns - so
     * this is exactly the pairing that used to mislabel the track.
     */
    console.log('\nTHE RENDERER JOINS NARRATION AND FOOTAGE CLEANLY');
    const mp3 = join(work, 'n.mp3');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=2',
      '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
    const narration = await readFile(mp3);
    chk('the narration really is mono',
      /mono/.test((await probe(mp3)).match(/Audio:.*/)?.[0] ?? ''),
      'the whole mismatch started here');

    const renderer = new FfmpegVideoRenderer(BIN, { timeoutMsPerScene: 120_000 });
    const libraryScene = { sceneType: 'LIBRARY_SEGMENT', heading: 'Company introduction',
      narration: null, segment: seg.output, durationMs: seg.durationMs };
    const generatedScene = { sceneType: 'WELCOME', heading: 'Welcome',
      narration: 'Welcome to the site.', audio: narration, durationMs: 2000 };

    /*
     * BOTH ORDERS, and that is not thoroughness for its own sake.
     *
     * The concat demuxer writes the FIRST part's channel layout into the track
     * header. With footage first the header says stereo whatever the generated
     * scenes are, so a mono generated scene is invisible - a mutation that stripped
     * the renderer's `-ac` passed this suite until the narration-first case existed.
     * The order that catches it is the one a real induction usually has: a spoken
     * welcome, then the company video.
     */
    for (const [label, scenes] of [
      ['company video first', [libraryScene, generatedScene]],
      ['narration first', [generatedScene, libraryScene]],
    ] as const) {
      const out = await renderer.render({
        siteName: 'Audio Spec Test', version: 1, scenes,
      } as never);
      const finalPath = join(work, `induction-${label.replace(/ /g, '-')}.mp4`);
      await writeFile(finalPath, out.mp4);
      const finalInfo = await probe(finalPath);
      chk(`[${label}] exactly one audio stream`, audioLines(finalInfo).length === 1);
      chk(`[${label}]   declared at the spec's channel count`,
        new RegExp(AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono')
          .test(audioLines(finalInfo)[0] ?? ''),
        (audioLines(finalInfo)[0] ?? '').trim().slice(0, 78));
      chk(`[${label}] both parts are present`, /Duration: 00:00:0[45]/.test(finalInfo),
        (finalInfo.match(/Duration: [^,]+/) ?? [''])[0]);
      chk(`[${label}] the video is still portrait`, /1080x1920/.test(finalInfo));

      // The symptom the mismatch used to produce, on the actual joined file.
      const { stderr: decode } = await run(BIN,
        ['-hide_banner', '-nostdin', '-y', '-i', finalPath, '-vn', '-f', 'null', '-'])
        .catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? '') }));
      chk(`[${label}] no non-monotonic DTS when decoding the join`,
        !/Non-monotonic DTS/i.test(decode),
        'this warned at every boundary while the layouts disagreed');
      chk(`[${label}] no decode errors at all`,
        !/\b(error|invalid data|corrupt)\b/i.test(decode));
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
