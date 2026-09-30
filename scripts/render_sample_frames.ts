export {};
/**
 * Render a fixed sample induction and keep frames from it, so the PICTURE can be
 * compared before and after a change instead of argued about.
 *
 * The content is deliberately constant: the same three scenes, the same words, the
 * same silent audio lengths. Anything that differs between two runs is the change.
 *
 * Run: npx tsx scripts/render_sample_frames.ts <outdir> [label]
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const run = promisify(execFile);

const {
  FfmpegVideoRenderer,
  ffmpegBinary,
  ffprobeBinary,
} = require('../services/inductionVideo/ffmpegRenderer');
const { brandMotionReady } = require('../services/inductionVideo/brandMotion');

const OUT = process.argv[2] ?? '/tmp/render-sample';
const LABEL = process.argv[3] ?? 'sample';

/** The Company Introduction wording, plus two site scenes with different families. */
const SCENES = [
  {
    sceneType: 'WELCOME',
    heading: 'Welcome to Dorchester Road',
    narration:
      'Welcome to the Dorchester Road project. This induction takes about four minutes. '
      + 'Watch it through before you start work.',
    seconds: 7,
  },
  {
    sceneType: 'EMERGENCY_PROCEDURES',
    heading: 'If the alarm sounds',
    narration:
      'If the alarm sounds, stop what you are doing. Leave by the nearest marked exit. '
      + 'Go to the muster point and wait to be counted.',
    seconds: 8,
  },
  {
    sceneType: 'PPE',
    heading: 'What you must wear',
    narration:
      'A hard hat and hi-vis are required everywhere on this site. '
      + 'Safety boots and gloves are required in the working areas. '
      + 'Ask your supervisor if anything you have been issued does not fit.',
    seconds: 9,
  },
];

(async () => {
  await mkdir(OUT, { recursive: true });
  const bin = ffmpegBinary();
  if (!bin) throw new Error('no ffmpeg: set FFMPEG_PATH');
  console.log(`\n  ${LABEL}: ffmpeg ${bin}`);
  console.log(`  brandMotionReady(): ${brandMotionReady()}`);

  const silence = async (seconds: number, file: string) => {
    await run(bin, [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '96k', file,
    ]);
    return readFile(file);
  };

  const scenes = [];
  for (const [i, s] of SCENES.entries()) {
    scenes.push({
      sceneType: s.sceneType,
      heading: s.heading,
      narration: s.narration,
      audio: await silence(s.seconds, join(OUT, `a${i}.mp3`)),
      durationMs: s.seconds * 1000,
    });
  }

  const out = await new FfmpegVideoRenderer(bin).render({
    siteName: 'Dorchester Road',
    version: 1,
    scenes,
  });

  const mp4 = join(OUT, `${LABEL}.mp4`);
  await writeFile(mp4, out.mp4);
  const { stdout } = await run(ffprobeBinary(bin), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4,
  ]);
  const total = Number(stdout.trim());
  console.log(`  rendered ${(out.mp4.length / 1024).toFixed(0)} kB, ${total.toFixed(1)}s`);

  /*
   * Sampled INSIDE each scene rather than at fixed offsets, so a change in bumper
   * length cannot silently move the sample onto a different scene and make a
   * before/after pair incomparable.
   */
  const picks: { at: number; what: string }[] = [
    { at: 1.2, what: 'sting' },
    { at: total * 0.18, what: 'welcome' },
    { at: total * 0.28, what: 'welcome-late' },
    { at: total * 0.5, what: 'emergency' },
    { at: total * 0.78, what: 'ppe' },
    { at: total - 0.6, what: 'closing' },
  ];
  for (const [i, p] of picks.entries()) {
    const f = join(OUT, `${LABEL}-${String(i + 1).padStart(2, '0')}-${p.what}.png`);
    await run(bin, ['-hide_banner', '-nostdin', '-y', '-ss', p.at.toFixed(2), '-i', mp4,
      '-frames:v', '1', '-vf', 'scale=360:-1', f]);
  }
  console.log(`  ${picks.length} frames in ${OUT}\n`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
