export {};
/**
 * THE VISUAL LAYER: branded motion, scene templates, animated text.
 *
 * What this protects, in the order the risks are:
 *  - THE CAPTION CONTRACT. Subtitles are timed during narration by adding up the
 *    running order; the renderer splices branded clips into it. If a declared
 *    duration and a real file disagree by even a frame, every subtitle after the
 *    first bumper drifts, and each further bumper makes it worse. That is a fault
 *    that degrades through a video rather than announcing itself.
 *  - STREAM-COPY COMPATIBILITY. Every clip must be at the pipeline spec or the join
 *    mislabels the track instead of failing.
 *  - ONE RUNNING ORDER. Narration and rendering call the same pure function.
 *  - EVERY SCENE TYPE IS DESIGNED, not silently defaulted.
 *  - IT ACTUALLY RENDERS AND JOINS, proven with real ffmpeg.
 *
 * Run: FFMPEG_PATH=$PWD/vendor/ffmpeg/ffmpeg npx tsx scripts/brand_motion_verify.ts
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const run = promisify(execFile);
const bm = require('../services/inductionVideo/brandMotion');
const tl = require('../services/inductionVideo/timeline');
const st = require('../services/inductionVideo/sceneTemplates');
const { sceneVisual, toneForScene } = require('../services/inductionVideo/sceneVisual');
const { sceneAss } = require('../services/inductionVideo/assDocument');
const { buildCues } = require('../services/inductionVideo/captions');
const { VIDEO_FORMAT, AUDIO_FORMAT } = require('../services/inductionVideo/videoFormat');
const { readFileSync } = require('fs');

const BIN = process.env.FFMPEG_PATH || `${process.cwd()}/vendor/ffmpeg/ffmpeg`;
let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const probe = async (f: string) => {
  try { return (await run(BIN, ['-hide_banner', '-i', f])).stderr as string; }
  catch (e: unknown) { return String((e as { stderr?: string }).stderr ?? ''); }
};
const durationMsOf = (info: string) => {
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(info);
  if (!m) return 0;
  return Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 +
    Number(m[4].padEnd(3, '0').slice(0, 3));
};

(async () => {
  const work = await mkdtemp(join(tmpdir(), 'brandmotion-'));
  try {
    console.log('\nEVERY CLIP EXISTS, AND IS EXACTLY AS LONG AS DECLARED');
    chk('the whole set is present', bm.brandMotionReady() === true,
      'half a set would mean narration timing one order and the renderer producing another');
    for (const asset of bm.allBrandMotionAssets()) {
      const info = await probe(bm.brandMotionFile(asset.key));
      const actual = durationMsOf(info);
      // 40ms is one frame at 25fps: the encoder rounds to whole frames.
      chk(`${asset.key}: declared ${asset.durationMs}ms, file ${actual}ms`,
        Math.abs(actual - asset.durationMs) <= 40,
        Math.abs(actual - asset.durationMs) <= 40 ? '' : 'CAPTIONS WILL DRIFT');
      chk(`  ${asset.key}: at the pipeline spec`,
        new RegExp(`${VIDEO_FORMAT.width}x${VIDEO_FORMAT.height}`).test(info) &&
          new RegExp(`${VIDEO_FORMAT.fps} fps`).test(info) &&
          /yuv420p/.test(info),
        'a mismatched part cannot be stream-copied into an induction');
      chk(`  ${asset.key}: one ${AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono'} ${AUDIO_FORMAT.sampleRate} Hz track`,
        (info.match(/Audio:/g) ?? []).length === 1 &&
          new RegExp(`${AUDIO_FORMAT.sampleRate} Hz, ${AUDIO_FORMAT.channels === 2 ? 'stereo' : 'mono'}`).test(info));
    }

    console.log('\nEVERY SCENE TYPE HAS A DELIBERATE TREATMENT');
    const rules = readFileSync('services/inductionVideo/sceneRules.ts', 'utf8');
    const declared = [...new Set(
      (rules.match(/^\s+\|\s+'([A-Z_]+)'/gm) ?? []).map((l: string) => l.replace(/\D+/g, '') ? l : l)
        .map((l: string) => (/'([A-Z_]+)'/.exec(l) ?? [])[1])
        .filter(Boolean),
    )] as string[];
    chk('the scene-type list was found', declared.length >= 25, `${declared.length} types`);
    const missing = declared.filter((t) => !st.hasTemplate(t));
    chk('none is falling through to a generic card', missing.length === 0,
      missing.join(', ') || 'all designed');

    console.log('\nTHE CARD\'S TONE IS STILL THE SCENE\'S OWN DECISION');
    /*
     * There is deliberately no family→tone map. One was written and the check below,
     * in its first form, found it contradicting toneForScene in nine places - all of
     * which were considered decisions a family rule cannot express: an assembly point
     * is SAFE green because it is where you go to be safe, not ALERT red. So the
     * family decides the BUMPER and the scene keeps deciding its own card.
     */
    chk('no family-level tone map overrides the per-scene choice',
      st.FAMILY_TONE === undefined,
      'a coarse rule would have repainted nine deliberate decisions');
    chk('  and every scene still resolves a tone',
      declared.every((t) => ['BRAND', 'ALERT', 'SAFE', 'NEUTRAL'].includes(toneForScene(t))));
    chk('  an assembly point stays reassuring, not alarming',
      toneForScene('FIRE_MUSTER_POINT') === 'SAFE',
      'the one that proved the family map wrong');

    console.log('\nBUMPERS SIGNPOST SECTIONS, THEY DO NOT PUNCTUATE SCENES');
    /*
     * BOTH of these request a bumper (SITE_HAZARDS and ASBESTOS), which is the point:
     * the first version of this test used four hazard scenes of which only one asked
     * for a bumper, so it would have passed even with the run logic deleted.
     */
    const run5 = tl.buildTimeline([
      { sceneType: 'SITE_HAZARDS', durationMs: 8000 },
      { sceneType: 'ASBESTOS', durationMs: 8000 },
      { sceneType: 'EXISTING_RISKS', durationMs: 8000 },
      { sceneType: 'WORK_AT_HEIGHT', durationMs: 8000 },
    ], true);
    const hazardBumpers = run5.filter(
      (p: { kind: string; assetKey?: string }) => p.assetKey === 'bumper-hazard').length;
    chk('hazard scenes in a row get ONE bumper between them', hazardBumpers === 1,
      `${hazardBumpers} — two scenes here both ask for one; the run logic is what stops it`);
    const alternating = tl.buildTimeline([
      { sceneType: 'SITE_HAZARDS', durationMs: 6000 },
      { sceneType: 'WELFARE', durationMs: 6000 },
      { sceneType: 'SITE_HAZARDS', durationMs: 6000 },
    ], true);
    chk('a family that returns later gets another', alternating.filter(
      (p: { assetKey?: string }) => p.assetKey === 'bumper-hazard').length === 2,
      'by then the viewer has been somewhere else');
    chk('the sting opens and the plate closes',
      run5[0].assetKey === 'sting' && run5[run5.length - 1].assetKey === 'closing');
    chk('a scene with no measured audio triggers no bumper',
      tl.buildTimeline([{ sceneType: 'SITE_HAZARDS', durationMs: 0 }], true).length === 0,
      'the caption builder skips it too');
    chk('with the assets absent, the order is scenes only',
      tl.buildTimeline([{ sceneType: 'WELCOME', durationMs: 5000 }], false)
        .every((p: { kind: string }) => p.kind === 'SCENE'));

    console.log('\nSUBTITLES ARE TIMED AGAINST THE RENDERED ORDER');
    /*
     * THE TEST THIS FILE EXISTS FOR. Two scenes with a bumper between them: the
     * second scene's first cue must start AFTER the first scene plus both clips, not
     * after the first scene alone.
     */
    const scenes = [
      { sceneType: 'WELCOME', durationMs: 4000, narration: 'Welcome to the site.', heading: 'Welcome' },
      { sceneType: 'FIRE_MUSTER_POINT', durationMs: 4000, narration: 'The assembly point is the main gate.', heading: 'Assembly point' },
    ];
    const timeline = tl.buildTimeline(scenes, true);
    const timed = timeline.map((p: { kind: string; index?: number; durationMs: number; label?: string }) =>
      p.kind === 'BRAND'
        ? { heading: p.label, narration: '', durationMs: p.durationMs }
        : { heading: scenes[p.index!].heading, narration: scenes[p.index!].narration,
            durationMs: scenes[p.index!].durationMs });
    const cues = buildCues(timed);
    // Compare against the SAME scenes with no clips: the counts must be identical,
    // because a branded part consumes time and says nothing. Matching words was the
    // first attempt and it failed on the narration "Welcome to the site." - the test
    // was wrong, not the code.
    const cuesWithout = buildCues(scenes.map((sc) => ({
      heading: sc.heading, narration: sc.narration, durationMs: sc.durationMs,
    })));
    chk('branded clips add no subtitles of their own',
      cues.length === cuesWithout.length && cues.length > 0,
      `${cues.length} cues with clips, ${cuesWithout.length} without`);
    const beforeSecond = tl.brandedMs(timeline.slice(0, timeline.findIndex(
      (p: { kind: string; index?: number }) => p.kind === 'SCENE' && p.index === 1))) + 4000;
    const secondCue = cues.find((c: { text: string }) => /assembly point/i.test(c.text));
    chk('the second scene\'s cue starts after the clips before it',
      Boolean(secondCue) && secondCue.startMs >= beforeSecond - 60,
      `cue at ${secondCue?.startMs}ms, scene starts at ${beforeSecond}ms`);
    chk('  and not merely after the first scene',
      Boolean(secondCue) && secondCue.startMs > 4000,
      'this is the drift the shared timeline prevents');
    chk('the running order is longer than the scenes alone',
      tl.timelineDurationMs(timeline) === 8000 + tl.brandedMs(timeline),
      `${tl.timelineDurationMs(timeline)}ms total, ${tl.brandedMs(timeline)}ms branded`);

    console.log('\nTHE TEXT MOVES, AND THE MOTION IS IN THE ASS FILE');
    const hazard = sceneVisual({ sceneType: 'SITE_HAZARDS', heading: 'Hazards',
      narration: 'Overhead work is in progress. Keep to the marked routes. Wear your hard hat.' });
    chk('a hazard scene is staggered', hazard.textMotion === 'STAGGER');
    chk('  and carries its accent', hazard.accent === 'HAZARD_STRIPE');
    const hazardAss = sceneAss(hazard, 9000, 'Site · v1');
    // Count BODY events specifically, and require one per line. Counting every
    // Dialogue line passed with staggering disabled, because heading + one merged body
    // + footer is also three.
    const bodyEvents = (hazardAss.match(/^Dialogue: 0,[^,]+,[^,]+,Body,/gm) ?? []).length;
    chk('  each line is its own timed event',
      bodyEvents === hazard.lines.length && bodyEvents > 1,
      `${bodyEvents} body events for ${hazard.lines.length} lines`);
    chk('  and they start at different times',
      new Set((hazardAss.match(/^Dialogue: 0,([^,]+),/gm) ?? [])).size > 1,
      'arriving together is a wall of text; arriving in turn is a briefing');
    chk('  with a fade on each', /\\fad\(/.test(hazardAss));
    const muster = sceneVisual({ sceneType: 'FIRE_MUSTER_POINT', heading: 'Assembly point',
      narration: 'The assembly point is the main gate on Bell Street.' });
    chk('an emergency fact is emphasised, not staggered', muster.textMotion === 'EMPHASIS');
    chk('  and grows into place', /\\t\(0,\d+,\\fscx100/.test(sceneAss(muster, 6000)));
    const map = sceneVisual({ sceneType: 'SITE_MAP', heading: 'Site map', narration: 'This is the site.' });
    chk('the map scene is deliberately STILL', map.textMotion === 'STILL',
      'honest: it holds no image yet');
    chk('  so its text carries no motion tags', !/\\fad\(|\\move\(/.test(sceneAss(map, 5000)));
    const welcome = sceneAss(sceneVisual({ sceneType: 'WELCOME', heading: 'Welcome',
      narration: 'Welcome.' }), 5000);
    chk('a heading settles into place', /\\move\(540,\d+,540,\d+,0,\d+\)/.test(welcome));

    console.log('\nTHE WIRING IS IN PLACE WHERE THE BEHAVIOUR CANNOT BE REACHED HERE');
    /*
     * These are source assertions, deliberately. The cue arithmetic above proves the
     * timeline is right; what it cannot reach is narrationService writing the VTT from
     * the TIMED list, or the renderer drawing the accent, because both live inside
     * functions that need a database and a storage port. Mutation testing found both
     * gaps: deleting either passed every behavioural check in this file.
     */
    const narr = readFileSync('services/inductionVideo/narrationService.ts', 'utf8');
    chk('narration builds the running order with the shared function',
      /buildTimeline\(/.test(narr));
    chk('  and writes the VTT from the TIMED list, not the raw scenes',
      /buildVtt\(timedScenes\)/.test(narr),
      'timing against the scenes alone is the drift this whole module prevents');
    const rend = readFileSync('services/inductionVideo/ffmpegRenderer.ts', 'utf8');
    chk('the renderer builds its part list from the same function',
      /buildTimeline\(/.test(rend));
    chk('  and draws the accent into the filter chain',
      /const accent = accentFilter\(visual, width, height\);/.test(rend) &&
        /\[0:v\]\$\{accent\}ass=/.test(rend),
      'the template can name an accent that nothing draws');
    chk('  and fades each part at its own edges',
      /fade=t=in:st=0/.test(rend) && /fade=t=out:st=/.test(rend),
      'a cross-fade would re-encode the whole induction; edge fades are free');

    console.log('\nNOTHING IS DRAWN THROUGH THE WORDS');
    /*
     * BOTH OF THESE WERE REAL, AND BOTH WERE FOUND BY LOOKING AT A FRAME rather than
     * by any check. The scene accent sat at 0.165 of the frame height and the heading
     * is anchored at 0.12 in a 72pt face, so the hazard stripes ran straight through
     * "HAZARDS ON THIS SITE". The bumper rule sat at 46% and a two-line title centred
     * at 50% starts above that, so the rule crossed its first line. Every automated
     * check passed both times: the files rendered, the durations were right, the
     * frames had content.
     *
     * Arithmetic, not pixels: the geometry either clears or it does not.
     */
    const rendSrc = readFileSync('services/inductionVideo/ffmpegRenderer.ts', 'utf8');
    const accentY = Number(/ACCENT_Y = Math\.round\(VIDEO_FORMAT\.height \* ([\d.]+)\)/
      .exec(rendSrc)?.[1] ?? 0) * VIDEO_FORMAT.height;
    const headingTop = VIDEO_FORMAT.height * 0.12; // SAFE_AREA.topFraction
    const accentHeight = VIDEO_FORMAT.height * 0.011; // the tallest of the three
    chk('a scene accent clears the heading it sits above',
      accentY > 0 && accentY + accentHeight < headingTop,
      `accent ends at ${Math.round(accentY + accentHeight)}px, heading starts at ${Math.round(headingTop)}px`);
    chk('  and clears the brand mark above it',
      accentY > VIDEO_FORMAT.height * 0.045 + 60,
      'the mark sits at 4.5% and is about 55px tall');
    const buildSrc = readFileSync('scripts/build_brand_motion.sh', 'utf8');
    const rulePct = Number(/drawbox=x=0:y=\$\(\(H\*(\d+)\/100\)\)/.exec(buildSrc)?.[1] ?? 0);
    chk('a bumper rule clears a TWO-LINE title centred in the frame',
      rulePct > 0 && rulePct < 44,
      `rule at ${rulePct}% — a two-line 96pt title centred at 50% starts near 45%`);

    console.log('\nIT RENDERS, AND IT JOINS — REAL FFMPEG');
    const { FfmpegVideoRenderer } = await import('../services/inductionVideo/ffmpegRenderer');
    const mp3 = join(work, 'n.mp3');
    await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=24000:duration=4',
      '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
    const audio = await readFile(mp3);
    const renderer = new FfmpegVideoRenderer(BIN, { timeoutMsPerScene: 180_000 });
    const t0 = Date.now();
    const out = await renderer.render({
      siteName: 'Brand Motion Test', version: 1,
      scenes: [
        { sceneType: 'WELCOME', heading: 'Welcome', narration: 'Welcome to the site.',
          audio, durationMs: 4000 },
        { sceneType: 'SITE_HAZARDS', heading: 'Hazards',
          narration: 'Overhead work. Keep to the routes. Hard hat on.', audio, durationMs: 4000 },
        { sceneType: 'FIRE_MUSTER_POINT', heading: 'Assembly point',
          narration: 'The assembly point is the main gate.', audio, durationMs: 4000 },
      ],
    } as never);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const final = join(work, 'induction.mp4');
    await writeFile(final, out.mp4);
    const info = await probe(final);
    chk('an induction rendered', out.mp4.length > 20_000,
      `${(out.mp4.length / 1024).toFixed(0)} KB in ${secs}s on this machine`);
    const expected = tl.timelineDurationMs(tl.buildTimeline([
      { sceneType: 'WELCOME', durationMs: 4000 },
      { sceneType: 'SITE_HAZARDS', durationMs: 4000 },
      { sceneType: 'FIRE_MUSTER_POINT', durationMs: 4000 },
    ], true));
    const actual = durationMsOf(info);
    chk('its length matches the running order the captions were timed to',
      Math.abs(actual - expected) <= 200,
      `${actual}ms rendered vs ${expected}ms planned`);
    chk('  which is longer than the narration alone', actual > 12_000,
      `${actual - 12_000}ms of branded motion`);
    chk('still portrait, still one stereo track',
      new RegExp(`${VIDEO_FORMAT.width}x${VIDEO_FORMAT.height}`).test(info) &&
        (info.match(/Audio:/g) ?? []).length === 1 && /stereo/.test(info));
    const { stderr: dec } = await run(BIN, ['-hide_banner', '-nostdin', '-y', '-i', final,
      '-f', 'null', '-']).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? '') }));
    chk('it decodes cleanly across every join',
      !/Non-monotonic DTS/i.test(dec) && !/\b(invalid data|corrupt)\b/i.test(dec));
    // A frame from inside a bumper must not be the same flat colour as a scene card.
    for (const [label, at] of [['sting', '1'], ['first scene', '3.5']] as const) {
      const png = join(work, `f-${label.replace(/ /g, '-')}.png`);
      await run(BIN, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', at,
        '-i', final, '-frames:v', '1', png]);
      const bytes = (await require('node:fs/promises').stat(png)).size;
      chk(`a frame from the ${label} has real content`, bytes > 3_000,
        `${(bytes / 1024).toFixed(0)} KB PNG`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
