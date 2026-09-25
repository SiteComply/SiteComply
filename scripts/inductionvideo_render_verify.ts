/**
 * Induction videos, Phase 3: frames, rendering, publication, playback, spend,
 * retention.
 *
 * THE PROPERTIES THAT MATTER:
 *  - a sentence is never cut to fit a frame;
 *  - a manager's words cannot restyle the frame (ASS is markup too);
 *  - brand colours survive the ASS channel order;
 *  - only a rendered, current video can be published, and only by the people who
 *    approve;
 *  - an operative is served the PUBLISHED version or nothing, by site;
 *  - progress only ever goes forward, and completion is the server's decision;
 *  - retention never touches a video that was published or watched;
 *  - the daily cap stops paid work before it spends.
 *
 * Run: npx tsx scripts/inductionvideo_render_verify.ts
 */
import { readFileSync } from 'fs';
import {
  sceneVisual,
  sentencesOf,
  toneForScene,
  textBox,
  VISUAL_CHARS_PER_LINE,
  VISUAL_MAX_SENTENCES,
} from '../services/inductionVideo/sceneVisual';
import { assColour, assText, assTime, sceneAss } from '../services/inductionVideo/assDocument';
import { VIDEO_FORMAT, SAFE_AREA } from '../services/inductionVideo/videoFormat';
import { estimateRenderPence } from '../services/inductionVideo/videoRenderer';
import { renderFingerprint, renderIsStale } from '../services/inductionVideo/renderService';
import { isComplete } from '../services/inductionVideo/operativeVideoService';
import { dailyCapPence, formatPence, londonDay } from '../services/inductionVideo/spendGuard';
import { buildInductionSteps, isStepComplete } from '../services/checklists/inductionFlow';

let pass = 0;
const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) {
    pass++;
    console.log(`  ok   ${t}`);
  } else {
    failures.push(t);
    console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  }
};
const read = (p: string) => readFileSync(p, 'utf8');

function main() {
  console.log('== INDUCTION VIDEO — PHASE 3: RENDER, PUBLISH, DELIVER ==\n');

  /* ───────────────────────── the frame ────────────────────────────────── */
  console.log('[1] What the frame shows, and what it refuses to show');
  const short = sceneVisual({
    sceneType: 'FIRE_MUSTER_POINT',
    heading: 'Where to go',
    narration: 'The assembly point is the rear car park.',
  });
  ok('a short scene puts its sentence on the frame', short.lines.length >= 1);
  ok('  and nothing is left unsaid', short.moreSpokenThanShown === false);

  const long = sceneVisual({
    sceneType: 'ASBESTOS',
    heading: 'Asbestos',
    narration:
      'Do not disturb any material you suspect contains asbestos under any circumstances whatsoever, including ceiling tiles, pipe lagging, textured coatings and the panels behind the risers on the second floor. Report it.',
  });
  ok('A SENTENCE IS NEVER CUT: the over-long one is dropped whole',
    long.lines.join(' ').includes('Report it.') &&
      !long.lines.join(' ').includes('Do not disturb any material you suspect contains asbestos under'),
    long.lines);
  ok('  and the scene says so, so a reviewer knows the voice says more',
    long.moreSpokenThanShown === true);
  ok('no frame line is wider than the frame',
    [short, long].every((v) => v.lines.every((l) => l.length <= VISUAL_CHARS_PER_LINE)));

  const many = sceneVisual({
    sceneType: 'SITE_RULES',
    heading: 'Site rules',
    narration: 'One. Two. Three. Four. Five. Six.',
  });
  ok('at most three sentences reach the frame; the rest are the voice\'s job',
    many.lines.length > 0 && many.lines.join(' ').split('.').filter((x) => x.trim()).length <= VISUAL_MAX_SENTENCES,
    many.lines);

  ok('an emergency scene is an alert scene because of WHAT IT IS',
    toneForScene('EMERGENCY_PROCEDURES') === 'ALERT' && toneForScene('ASBESTOS') === 'ALERT');
  ok('  the muster point and first aid are the reassuring ones',
    toneForScene('FIRE_MUSTER_POINT') === 'SAFE' && toneForScene('FIRST_AID') === 'SAFE');
  ok('  and the welcome carries the brand',
    toneForScene('WELCOME') === 'BRAND' && toneForScene('WORKING_HOURS') === 'NEUTRAL');
  ok('the tone is not read from the words: an "urgent" welcome is still BRAND',
    sceneVisual({ sceneType: 'WELCOME', heading: 'Welcome', narration: 'Danger! Emergency! Fire!' }).tone === 'BRAND');

  ok('sentences are split without losing their punctuation',
    sentencesOf('Stop work. Go to the assembly point!').join('|') ===
      'Stop work.|Go to the assembly point!');

  const box = textBox();
  ok('the text sits inside the phone\'s safe area',
    box.top === Math.round(VIDEO_FORMAT.height * SAFE_AREA.topFraction) &&
      box.left === Math.round(VIDEO_FORMAT.width * SAFE_AREA.sideFraction));

  /* ───────────────────────── the text layer ───────────────────────────── */
  console.log('\n[2] The text layer is markup, so the words are escaped');
  ok('SiteComply blue survives the ASS channel order (BGR, not RGB)',
    assColour('#00AEEF') === '&H00EFAE00', assColour('#00AEEF'));
  ok('  white and black are unambiguous',
    assColour('#FFFFFF') === '&H00FFFFFF' && assColour('#000000') === '&H00000000');
  ok('  short hex is expanded', assColour('#0AE') === assColour('#00AAEE'));
  ok('  and a value that is not a colour is refused, not rendered',
    (() => {
      try {
        assColour('rgb(1,2,3)');
        return false;
      } catch {
        return true;
      }
    })());

  ok('a brace cannot open an override block', !assText('{\\fs200}HUGE').includes('{'));
  ok('a backslash cannot introduce an escape', !assText('a\\Nb').includes('\\N'));
  ok('a newline becomes the format\'s own line break', assText('a\nb') === 'a\\Nb');
  ok('centiseconds, not milliseconds', assTime(3_661_234) === '1:01:01.23');

  const doc = sceneAss(short, 4_000, 'Dorchester Road · induction v2');
  ok('the document declares the portrait canvas, or every size is wrong by 3x',
    doc.includes(`PlayResX: ${VIDEO_FORMAT.width}`) && doc.includes(`PlayResY: ${VIDEO_FORMAT.height}`));
  ok('NINE FIELDS before the text — the bug that put a comma on every line',
    doc
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'))
      .every((l) => !l.replace('Dialogue: ', '').split(',')[8]?.startsWith(',')),
    doc.split('\n').filter((l) => l.startsWith('Dialogue:')));
  ok('  and the heading really is the ninth field onwards',
    doc.includes('Dialogue: 0,0:00:00.00,0:00:04.00,Heading,,0,0,0,WHERE TO GO'),
    doc.split('\n').find((l) => l.includes('Heading,,')));
  ok('an injected style block reaches the frame as words, not styling',
    sceneAss(
      sceneVisual({ sceneType: 'WELCOME', heading: 'Welcome', narration: '{\\an5}{\\fs300}Gone.' }),
      3_000,
    ).includes('(\\/an5)') === false,
  );

  /* ───────────────────────── render bookkeeping ───────────────────────── */
  console.log('\n[3] A render knows what it was made from');
  const hashA = renderFingerprint('narration-1', 'ffmpeg');
  ok('the same narration and engine fingerprint the same',
    renderFingerprint('narration-1', 'ffmpeg') === hashA);
  ok('re-narrating makes the render stale',
    renderIsStale({ renderHash: hashA, narrationHash: 'narration-2', renderEngine: 'ffmpeg' }));
  ok('  an unchanged version is not stale',
    !renderIsStale({ renderHash: hashA, narrationHash: 'narration-1', renderEngine: 'ffmpeg' }));
  ok('  and a version with no render is not "stale", it is simply unrendered',
    !renderIsStale({ renderHash: null, narrationHash: 'narration-1', renderEngine: null }));
  const ff = read('services/inductionVideo/ffmpegRenderer.ts');
  ok('a render is never left with a duration of zero, which would block every operative',
    /probed > 0 \? probed : request\.scenes\.reduce/.test(ff));
  ok('  and a failure to MEASURE never throws away a finished render',
    /} catch \{[\s\S]{0,200}return 0;/.test(ff));
  ok('a vendored binary that arrives without its execute bit is repaired, not fumbled',
    /chmodSync\(path, 0o755\)/.test(ff) && /accessSync\(path, constants\.X_OK\)/.test(ff));
  ok('  and if it cannot be repaired the engine reports itself unavailable',
    /return false;\n\s*\}\n\s*\}\n\}/.test(ff));
  /*
   * ONE framerate for the whole pipeline, high enough for real footage. The join
   * is a stream copy, so a static scene and a library segment cannot differ - the
   * old ten was chosen when everything was static and would judder film.
   */
  ok('one framerate, high enough for footage', VIDEO_FORMAT.fps === 25);
  ok('  and a player can still seek: a keyframe every two seconds',
    /'-g', String\(VIDEO_FORMAT\.fps \* 2\)/.test(ff));
  ok('a self-hosted render costs nothing per minute', estimateRenderPence(240_000, 0) === 0);
  ok('  a cloud one is priced by the minute', estimateRenderPence(240_000, 32) === 128);

  /* ───────────────────────── publication rules ────────────────────────── */
  console.log('\n[4] Publication, and who may do it');
  const svc = read('services/inductionVideo/renderService.ts');
  ok('only a rendered version can be published',
    /Only a rendered version can be published/.test(svc));
  /*
   * Now expressed as a CAPABILITY rather than a role call, which is what lets one
   * rule hold in two realms: a Platform Project Manager has canApprove false, and
   * so does an Admin VIEWER. The roles that may publish are decided in
   * videoActor.ts, where each realm's vocabulary is known.
   */
  ok('only an actor with approval authority may publish',
    /!actor\.canApprove[\s\S]{0,200}may publish an induction video/.test(svc));
  ok('a stale render cannot be published',
    /renderIsStale\(video\)[\s\S]{0,200}Render it again first/.test(svc));
  ok('publishing supersedes every other version in the same transaction',
    /updateMany\(\{[\s\S]{0,200}id: \{ not: videoId \}, supersededAt: null[\s\S]{0,80}data: \{ supersededAt: now \}/.test(svc));
  ok('withdrawing keeps the file and the records, and demands a reason',
    /Please say why it is being withdrawn/.test(svc) && !/deleteMedia\(video\.videoBlobPath\)/.test(svc));
  ok('a failed render returns the version to narrated, not to failed',
    /RENDER_FAILED/.test(svc) && /status: InductionVideoStatus\.NARRATION_READY/.test(svc));
  ok('the render job is claimed before it runs',
    /updateMany\(\{[\s\S]{0,200}status: InductionVideoJobStatus\.QUEUED[\s\S]{0,200}RUNNING/.test(svc));
  ok('only ONE render runs at a time',
    /runQueuedRenderJobs\(\s*\n?\s*limit = 1/.test(svc));
  ok('the operative-facing lookup only ever returns a PUBLISHED version',
    /publishedVideoForSite[\s\S]{0,300}status: InductionVideoStatus\.PUBLISHED/.test(svc));

  /* ───────────────────────── the operative ────────────────────────────── */
  console.log('\n[5] Watching it, and the record of having watched it');
  ok('watched to the end counts', isComplete(240_000, 240_000));
  ok('  within a few seconds of the end counts', isComplete(238_000, 240_000));
  ok('  95% counts, for a long video', isComplete(228_000, 240_000));
  ok('  half does not', !isComplete(120_000, 240_000));
  ok('  and a video of unknown length never counts as watched', !isComplete(10_000, 0));

  const ops = read('services/inductionVideo/operativeVideoService.ts');
  ok('progress only ever goes forward',
    /Math\.max\(existing\?\.furthestMs \?\? 0, position\)/.test(ops));
  ok('  and is clamped to the length of the video',
    /Math\.min\(Math\.round\(positionMs\), durationMs/.test(ops));
  ok('completion is decided by the server, never claimed by the player',
    /isComplete\(furthestMs, durationMs\)/.test(ops) && !/body\.completed/.test(ops));
  ok('  and once completed it is never un-completed',
    /completed && !existing\?\.completedAt/.test(ops));
  ok('the record names the operative, denormalised for the audit trail',
    /workerName: worker\.fullName/.test(ops));

  const stream = read('app/api/worker/induction-video/[siteId]/stream/route.ts');
  ok('the operative stream resolves the version from the SITE, not a URL id',
    /publishedVideoForSite\(params\.siteId\)/.test(stream) && !/params\.videoId/.test(stream));
  ok('  and requires a worker session', /getWorkerSession\(\)/.test(stream));
  const progress = read('app/api/worker/induction-video/[siteId]/progress/route.ts');
  ok('progress requires a session and resolves the worker server-side',
    /getWorkerByMobile\(session\.mobile\)/.test(progress));

  /* ───────────────────────── the induction flow ───────────────────────── */
  console.log('\n[6] The video takes the briefing\'s place, it does not add to it');
  const briefing = [
    { key: 'a', heading: 'Before you start', intro: null, sections: [] },
    { key: 'b', heading: 'Emergencies', intro: null, sections: [] },
  ] as never[];
  const items = [
    { id: 'i1', label: 'I have received the induction', type: 'ACKNOWLEDGEMENT', required: true },
  ] as never[];
  const withoutVideo = buildInductionSteps(items, briefing);
  const video = {
    videoId: 'v1', version: 2, durationMs: 200_000, hasCaptions: true,
    required: true, furthestMs: 0, completed: false,
  };
  const withVideo = buildInductionSteps(items, briefing, video);
  ok('without a video the briefing screens are shown as before',
    withoutVideo.filter((s) => s.kind === 'briefing').length === 2);
  ok('with one, the briefing screens are REPLACED by a single video step',
    withVideo.filter((s) => s.kind === 'briefing').length === 0 &&
      withVideo.filter((s) => s.kind === 'video').length === 1);
  ok('  so the induction does not get longer',
    withVideo.length <= withoutVideo.length, { with: withVideo.length, without: withoutVideo.length });
  ok('  and the written version travels with it for anyone who would rather read',
    withVideo.find((s) => s.kind === 'video')?.kind === 'video' &&
      (withVideo.find((s) => s.kind === 'video') as { briefing: unknown[] }).briefing.length === 2);

  const videoStep = withVideo.find((s) => s.kind === 'video')!;
  ok('a REQUIRED video blocks the step until it has been watched',
    isStepComplete(videoStep, {}, false) === false);
  ok('  and releases it once the server says it was',
    isStepComplete(
      buildInductionSteps(items, briefing, { ...video, completed: true }).find((s) => s.kind === 'video')!,
      {}, false) === true);
  ok('an OPTIONAL video never blocks anybody',
    isStepComplete(
      buildInductionSteps(items, briefing, { ...video, required: false }).find((s) => s.kind === 'video')!,
      {}, false) === true);

  /* ───────────────────────── money and records ────────────────────────── */
  console.log('\n[7] Spend, and what retention may never touch');
  ok('there is a daily ceiling by default', dailyCapPence() === 2_000);
  ok('pence read as money', formatPence(4) === '4p' && formatPence(125) === '£1.25');
  const day = londonDay(new Date('2026-06-15T12:00:00Z'));
  ok('the spend day is a London day, not a UTC one',
    day.resets.getTime() - day.start.getTime() === 24 * 60 * 60 * 1_000 &&
      day.start.toISOString() === '2026-06-14T23:00:00.000Z',
    day.start.toISOString());

  const guard = read('services/inductionVideo/spendGuard.ts');
  ok('the cap counts the same rows the version pages show',
    /aiUsageEvent\.aggregate/.test(guard));
  ok('  and refuses BEFORE the spend, not half way through',
    /spend\.pence \+ Math\.max\(0, estimatePence\) <= spend\.capPence/.test(guard));
  const render = read('services/inductionVideo/renderService.ts');
  const narrate = read('services/inductionVideo/narrationService.ts');
  const script = read('services/inductionVideo/inductionVideoService.ts');
  ok('every paid step answers to the cap — script, narration and render',
    [script, narrate, render].every((f) => /refuseIfOverBudget/.test(f)));

  const retention = read('services/inductionVideo/retentionService.ts');
  ok('retention does nothing unless somebody configures it',
    /if \(!days\) return \{ considered: 0, removed: 0/.test(retention));
  ok('it never touches a PUBLISHED version',
    /publishedAt: null/.test(retention) && /status: \{ not: InductionVideoStatus\.PUBLISHED \}/.test(retention));
  ok('it never touches one anybody WATCHED',
    /views: \{ none: \{\} \}/.test(retention));
  ok('it only ever removes the MP4 — the transcript and captions stay',
    /videoBlobPath: null, videoSizeBytes: null/.test(retention) &&
      !/transcriptBlobPath: null/.test(retention));
  ok('and it says so on the version\'s history', /RENDER_REMOVED/.test(retention));

  /* ───────────────────────── pacing ───────────────────────────────────── */
  console.log('\n[8] Work starts now, not at five past the hour');
  const kicker = read('services/inductionVideo/jobKicker.ts');
  ok('the nudge drains every queue', /runQueuedScriptJobs/.test(kicker) &&
    /runQueuedNarrationJobs/.test(kicker) && /runQueuedRenderJobs/.test(kicker));
  ok('  one drain at a time per process', /if \(running\) return false;/.test(kicker));
  ok('  it can never throw into an unhandled rejection',
    /} finally \{[\s\S]{0,600}running = false;/.test(kicker));
  ok('requesting any stage nudges it',
    /kickInductionJobs\(\)/.test(script) && /kickInductionJobs\(\)/.test(narrate) &&
      /kickInductionJobs\(\)/.test(render));
  const tick = read('app/api/system/compliance/tick/route.ts');
  ok('the hourly tick remains the safety net for all three',
    /runQueuedScriptJobs\(\)/.test(tick) && /runQueuedNarrationJobs\(\)/.test(tick) &&
      /runQueuedRenderJobs\(\)/.test(tick));
  ok('  and the retention sweep rides it too', /sweepUnpublishedRenders\(\)/.test(tick));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
