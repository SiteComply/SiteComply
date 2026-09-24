/**
 * Induction videos, Phase 2 (speech): narration, captions, storage.
 *
 * THE PROPERTIES THAT MATTER:
 *  - only approved words are ever spoken, and edited words silence their audio;
 *  - narration text is DATA in the SSML document, never markup;
 *  - a duration is measured from the audio, or admitted to be an estimate;
 *  - captions are cut to the audio and never drift, overlap or drop words;
 *  - the media is private, range-served, and a SAS link is short-lived and
 *    scoped to one blob;
 *  - a paid run is resumable and never buys the same scene twice.
 *
 * Run: npx tsx scripts/inductionvideo_speech_verify.ts
 */
import { readFileSync } from 'fs';
import {
  buildSsml,
  escapeXml,
  estimateDurationMs,
  mp3DurationMs,
  estimateNarrationPence,
  DEFAULT_VOICE,
} from '../services/inductionVideo/speechSynthesiser';
import {
  buildCues,
  buildTranscript,
  buildVtt,
  formatRunningTime,
  formatVttTime,
  splitForCaptions,
  wrapCaption,
  type CaptionScene,
} from '../services/inductionVideo/captions';
import { CAPTION_MAX_CHARS, CAPTION_MIN_MS, VIDEO_FORMAT } from '../services/inductionVideo/videoFormat';
import { parseRangeHeader } from '../services/inductionVideo/byteRange';
import {
  captionsPath,
  clampSasMinutes,
  MAX_SAS_MINUTES,
  sceneAudioPath,
  transcriptPath,
  videoMediaPrefix,
} from '../services/inductionVideo/mediaStorage';
import {
  narrationSetHash,
  sceneAudioHash,
  estimateNarrationForScenes,
} from '../services/inductionVideo/narrationService';

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

/** A real MPEG-2 Layer III frame stream: 24 kHz, 48 kbit/s, mono, 24 ms a frame. */
function fakeMp3(frames: number, withId3 = false): Buffer {
  const FRAME = 144; // floor(576/8 * 48000/24000)
  const parts: Buffer[] = [];
  if (withId3) {
    const tag = Buffer.alloc(10 + 30);
    tag.write('ID3', 0, 'ascii');
    tag[3] = 3;
    // syncsafe length of 30 bytes of payload
    tag[9] = 30;
    parts.push(tag);
  }
  for (let i = 0; i < frames; i++) {
    const frame = Buffer.alloc(FRAME);
    frame[0] = 0xff;
    frame[1] = 0xf3; // MPEG2, Layer III, no CRC
    frame[2] = 0x64; // 48 kbit/s, 24 kHz, no padding
    frame[3] = 0xc0; // mono
    parts.push(frame);
  }
  return Buffer.concat(parts);
}

/** A cue may start one millisecond after the last ends, and no later. */
function cuesGapTolerance(previousEnd: number): number {
  return previousEnd + 1;
}

function main() {
  console.log('== INDUCTION VIDEO — PHASE 2: SPEECH, CAPTIONS, STORAGE ==\n');

  /* ─────────────────────────────── SSML ──────────────────────────────── */
  console.log('[1] The narration is data, not markup');
  ok('the five XML characters are escaped',
    escapeXml(`& < > " '`) === '&amp; &lt; &gt; &quot; &apos;');
  const plain = buildSsml('Report to the site office. Wear your hard hat.', DEFAULT_VOICE);
  ok('one voice, one prosody, one speak element',
    (plain.match(/<voice/g) || []).length === 1 &&
      (plain.match(/<prosody/g) || []).length === 1 &&
      plain.startsWith('<speak') && plain.endsWith('</speak>'));
  ok('British English is declared', /xml:lang="en-GB"/.test(plain));
  ok('a breath is inserted between sentences', /<break time="350ms"\/>/.test(plain));

  const attack = buildSsml(
    'Stop work.</prosody></voice><voice name="en-US-Guy"><audio src="http://evil.example/x.mp3"/>',
    DEFAULT_VOICE,
  );
  ok('an injected voice cannot be opened — still exactly one <voice>',
    (attack.match(/<voice/g) || []).length === 1, attack.match(/<voice/g));
  ok('  and no <audio> element reaches the service',
    !/<audio/.test(attack));
  ok('  the attempt survives as visible text, escaped',
    attack.includes('&lt;audio src=&quot;http://evil.example/x.mp3&quot;/&gt;'));
  ok('a manager writing "scaffold < 2m" gets a valid document',
    buildSsml('Any scaffold < 2m is checked.', DEFAULT_VOICE).includes('scaffold &lt; 2m'));
  ok('the voice name is escaped too',
    buildSsml('Hello.', 'evil"/><audio src="x"/>').includes('&quot;'));
  ok('the standard narrator is a British voice', /^en-GB-/.test(DEFAULT_VOICE));

  /* ───────────────────────── measured duration ───────────────────────── */
  console.log('\n[2] A duration is measured, or admitted to be a guess');
  ok('100 frames of 24 kHz Layer III measure 2,400 ms',
    mp3DurationMs(fakeMp3(100)) === 2400, mp3DurationMs(fakeMp3(100)));
  ok('the length scales with the audio, exactly',
    mp3DurationMs(fakeMp3(250)) === 6000, mp3DurationMs(fakeMp3(250)));
  ok('an ID3 tag in front of the first frame is skipped',
    mp3DurationMs(fakeMp3(100, true)) === 2400, mp3DurationMs(fakeMp3(100, true)));
  ok('bytes that are not an MP3 measure null, rather than a plausible number',
    mp3DurationMs(Buffer.from('this is not audio at all, not even nearly')) === null);
  ok('  and an empty body measures null', mp3DurationMs(Buffer.alloc(0)) === null);
  ok('the fallback estimate is about 150 words a minute',
    Math.abs(estimateDurationMs(new Array(150).fill('word').join(' ')) - 60_000) < 1_000);
  ok('  and never returns zero for real text', estimateDurationMs('Go.') >= 1_000);

  /* ──────────────────────────── captions ─────────────────────────────── */
  console.log('\n[3] Captions are cut to the audio');
  const narration =
    'Welcome to Dorchester Road. Report to the site office before you start work. ' +
    'Wear your hard hat, boots and high-visibility vest at all times, and keep to the ' +
    'marked walkways when vehicles are moving on site.';
  const chunks = splitForCaptions(narration);
  ok('no chunk is wider than a portrait screen allows',
    chunks.every((c) => c.length <= CAPTION_MAX_CHARS), chunks.map((c) => c.length));
  ok('every word survives the split',
    chunks.join(' ').replace(/\s+/g, ' ') === narration.replace(/\s+/g, ' '),
    chunks.join(' '));
  ok('a short caption stays on one line',
    wrapCaption('Welcome to the site.').length === 1, wrapCaption('Welcome to the site.'));
  const wrapped = wrapCaption('Wear your hard hat, boots and high-visibility vest.');
  ok('a longer one becomes two balanced lines',
    wrapped.length === 2 && Math.abs(wrapped[0].length - wrapped[1].length) <= 8, wrapped);
  ok('  and no line is wider than half a cue',
    wrapped.every((l) => l.length <= Math.ceil(CAPTION_MAX_CHARS / 2)), wrapped.map((l) => l.length));
  ok('wrapping never loses a word',
    wrapCaption('Report to the site office before you start work today please').join(' ') ===
      'Report to the site office before you start work today please');

  const scenes: CaptionScene[] = [
    { heading: 'Welcome', narration, durationMs: 18_000 },
    { heading: 'Assembly point', narration: 'The assembly point is the rear car park.', durationMs: 4_000 },
  ];
  const cues = buildCues(scenes);
  /*
   * A SCENE'S CUES MUST FILL ITS SCENE, to the millisecond. The check is made at
   * every boundary with durations that do not divide evenly, because a single
   * scene whose text happens to round cleanly would pass whatever the code did.
   */
  const awkward: CaptionScene[] = [
    { heading: 'One', narration, durationMs: 17_777 },
    { heading: 'Two', narration, durationMs: 9_013 },
    { heading: 'Three', narration: 'The assembly point is the rear car park.', durationMs: 4_111 },
  ];
  const awkwardCues = buildCues(awkward);
  const bounds = awkward.reduce<number[]>(
    (acc, sc) => [...acc, (acc[acc.length - 1] ?? 0) + sc.durationMs],
    [],
  );
  ok('every scene\'s cues end exactly on the scene boundary',
    bounds.every((b) => awkwardCues.some((c) => c.endMs === b)),
    { bounds, ends: awkwardCues.map((c) => c.endMs) });
  ok('  and no cue straddles a boundary',
    awkwardCues.every((c) => !bounds.slice(0, -1).some((b) => c.startMs < b && c.endMs > b)));
  /*
   * SWEPT ACROSS MANY DURATIONS, because a single one can round cleanly by luck
   * and hide a cue list that stops short of its own audio - which is exactly how
   * captions start drifting a few seconds into a scene.
   */
  const sweepFailures: number[] = [];
  for (let d = 3_000; d <= 30_000; d += 137) {
    const swept = buildCues([{ heading: 'S', narration, durationMs: d }]);
    const end = swept[swept.length - 1]?.endMs;
    const gaps = swept.some((c, i) => i > 0 && c.startMs > swept[i - 1].endMs + 1);
    if (end !== d || gaps) sweepFailures.push(d);
  }
  ok('across 200 durations, the cues always fill the audio exactly and leave no gap',
    sweepFailures.length === 0, sweepFailures.slice(0, 5));

  ok('  and the cues cover the audio with no gaps',
    awkwardCues.every((c, i) => i === 0 || c.startMs <= cuesGapTolerance(awkwardCues[i - 1].endMs)),
    awkwardCues.map((c) => [c.startMs, c.endMs]));
  ok('there are cues for both scenes', cues.length >= 3);
  ok('the first cue starts at zero', cues[0].startMs === 0);
  ok('cues never overlap and never run backwards',
    cues.every((c, i) => c.endMs > c.startMs && (i === 0 || c.startMs >= cues[i - 1].endMs)));
  ok('the last cue ends exactly at the end of the audio',
    cues[cues.length - 1].endMs === 22_000, cues[cues.length - 1].endMs);
  ok('no cue crosses from one scene into the next',
    cues.every((c) => c.endMs <= 18_000 || c.startMs >= 18_000));
  ok('no cue flashes past unread',
    cues.every((c) => c.endMs - c.startMs >= CAPTION_MIN_MS - 1),
    cues.map((c) => c.endMs - c.startMs));
  ok('a scene with no audio contributes no cues',
    buildCues([{ heading: 'X', narration: 'Something.', durationMs: 0 }]).length === 0);

  ok('timestamps are HH:MM:SS.mmm', formatVttTime(3_661_234) === '01:01:01.234');
  ok('  and pad correctly at zero', formatVttTime(0) === '00:00:00.000');
  const vtt = buildVtt(scenes);
  ok('the file begins with the WEBVTT header, or no player will read it',
    vtt.startsWith('WEBVTT\n\n'));
  ok('  and contains an arrow-separated cue', / --> /.test(vtt));
  ok('running time reads in words', formatRunningTime(204_000) === '3 minutes 24 seconds');
  ok('  and handles a single minute', formatRunningTime(60_000) === '1 minute');

  const transcript = buildTranscript(
    { siteName: 'Dorchester Road', version: 3, totalMs: 22_000, voice: DEFAULT_VOICE },
    scenes,
  );
  ok('the transcript names the site and version',
    transcript.includes('Dorchester Road') && transcript.includes('Version 3'));
  ok('  carries every scene in full',
    scenes.every((s) => transcript.includes(s.narration)));
  ok('  and states the running time', transcript.includes('22 seconds'));

  /* ────────────────────────── hashing and reuse ──────────────────────── */
  console.log('\n[4] A paid run never buys the same scene twice');
  const a = sceneAudioHash('Report to the site office.', DEFAULT_VOICE);
  ok('the same words in the same voice hash the same',
    sceneAudioHash('Report to the site office.', DEFAULT_VOICE) === a);
  ok('  whitespace alone does not change it',
    sceneAudioHash('Report  to the   site office. ', DEFAULT_VOICE) === a);
  ok('changed words change the hash — the audio must be bought again',
    sceneAudioHash('Report to the site cabin.', DEFAULT_VOICE) !== a);
  ok('a changed voice changes the hash',
    sceneAudioHash('Report to the site office.', 'en-GB-ThomasNeural') !== a);
  ok('the set hash is order-sensitive: reordered scenes are a different induction',
    narrationSetHash(['x', 'y']) !== narrationSetHash(['y', 'x']));

  const est = estimateNarrationForScenes(['a'.repeat(3_500)]);
  ok('a 3,500-character induction is estimated at about 4p',
    est.pence >= 3 && est.pence <= 6, est);
  ok('  and an empty run costs nothing', estimateNarrationForScenes([]).pence === 0);
  ok('the rate is the one the plan quoted', estimateNarrationPence(1_000_000) === 1_200);

  /* ──────────────────────────── byte ranges ──────────────────────────── */
  console.log('\n[5] Media is served by the range a player asks for');
  ok('no header means the whole file', parseRangeHeader(null, 1_000) === null);
  const open = parseRangeHeader('bytes=0-', 1_000);
  ok('"bytes=0-" is the whole file as a range',
    typeof open === 'object' && open !== null && open.offset === 0 && open.count === 1_000);
  const mid = parseRangeHeader('bytes=100-199', 1_000);
  ok('an explicit range is exact',
    typeof mid === 'object' && mid !== null && mid.offset === 100 && mid.count === 100);
  // Deliberately ASYMMETRIC: 500 of 1,000 would read the same whether the
  // figure were treated as a length from the end or an offset from the start.
  const tail = parseRangeHeader('bytes=-200', 1_000);
  ok('"bytes=-200" is the LAST 200 bytes, not the first 200 or the rest',
    typeof tail === 'object' && tail !== null && tail.offset === 800 && tail.count === 200, tail);
  ok('  and asking for more tail than the file has yields the whole file',
    (parseRangeHeader('bytes=-5000', 1_000) as { offset: number; count: number }).offset === 0);
  ok('a range past the end is unsatisfiable, so the route can answer 416',
    parseRangeHeader('bytes=1000-', 1_000) === 'unsatisfiable');
  ok('a backwards range is unsatisfiable',
    parseRangeHeader('bytes=500-100', 1_000) === 'unsatisfiable');
  ok('an end past the file is clamped to the file',
    (parseRangeHeader('bytes=900-5000', 1_000) as { count: number }).count === 100);
  ok('a malformed header is ignored rather than trusted',
    parseRangeHeader('bytes=abc-def', 1_000) === null &&
      parseRangeHeader('items=0-1', 1_000) === null);
  ok('a huge range is capped, so one request cannot load a whole render into memory',
    (parseRangeHeader('bytes=0-', 100 * 1024 * 1024) as { count: number }).count ===
      2 * 1024 * 1024);

  /* ───────────────────────── storage conventions ─────────────────────── */
  console.log('\n[6] Storage is private, predictable, and per version');
  const p1 = sceneAudioPath('site1', 'vid1', 0, 'WELCOME');
  ok('a scene\'s audio path is deterministic — re-narrating overwrites it',
    p1 === sceneAudioPath('site1', 'vid1', 0, 'WELCOME'));
  ok('  and sorts in playing order', sceneAudioPath('s', 'v', 9, 'A') < sceneAudioPath('s', 'v', 10, 'A'));
  ok('  lives under its own version\'s prefix', p1.startsWith(videoMediaPrefix('site1', 'vid1')));
  ok('two versions never share a path', p1 !== sceneAudioPath('site1', 'vid2', 0, 'WELCOME'));
  ok('a scene type cannot escape the prefix',
    !sceneAudioPath('s', 'v', 0, '../../etc/passwd').includes('..'));
  ok('captions and the transcript sit beside the audio',
    captionsPath('s', 'v').endsWith('captions.vtt') &&
      transcriptPath('s', 'v').endsWith('transcript.txt') &&
      captionsPath('s', 'v').startsWith(videoMediaPrefix('s', 'v')));

  ok('a SAS link cannot be asked to last a week', clampSasMinutes(60 * 24 * 7) === MAX_SAS_MINUTES);
  ok('  nor zero or a negative lifetime', clampSasMinutes(0) === 1 && clampSasMinutes(-5) === 1);
  ok('  and two hours is the cap', MAX_SAS_MINUTES === 120);

  const storage = read('services/inductionVideo/mediaStorage.ts');
  ok('the container is created without public access',
    /createIfNotExists\(\)/.test(storage) && !/access:\s*'(blob|container)'/.test(storage));
  ok('media is stored uncacheable, so no proxy keeps a site\'s induction',
    /blobCacheControl: 'private, max-age=0, no-store'/.test(storage));
  ok('a SAS grants read only', /BlobSASPermissions\.parse\('r'\)/.test(storage));

  /* ───────────────────── the workflow's own guarantees ───────────────── */
  console.log('\n[7] Only approved words are spoken, and only once');
  const svc = read('services/inductionVideo/narrationService.ts');
  ok('narration requires an approved script',
    /Only an approved script can be narrated/.test(svc) &&
      /InductionVideoStatus\.SCRIPT_APPROVED/.test(svc));
  ok('a second request cannot double-spend while one is in flight',
    /Narration is already being generated/.test(svc) && /QUEUED, InductionVideoJobStatus\.RUNNING/.test(svc));
  ok('the job is claimed before it runs, so two ticks cannot double-run it',
    /updateMany\(\{[\s\S]{0,200}status: InductionVideoJobStatus\.QUEUED[\s\S]{0,200}RUNNING/.test(svc));
  ok('each scene is written as it completes, so a failed run is resumable',
    /inductionVideoScene\.update\(\{[\s\S]{0,300}audioBlobPath: path/.test(svc));
  ok('reuse checks the blob really exists, not just the hash',
    /scene\.audioHash === hash[\s\S]{0,200}await ports\.exists\(path\)/.test(svc));
  ok('only the characters actually bought are billed',
    /charsBilled \+= spoken\.chars/.test(svc) && /speechChars: charsBilled/.test(svc));
  ok('a failure returns the version to approved, not to failed',
    /NARRATION_FAILED/.test(svc) &&
      /status: InductionVideoStatus\.SCRIPT_APPROVED,/.test(svc));
  ok('a failed run withdraws the captions and running time it can no longer stand behind',
    /status: InductionVideoStatus\.SCRIPT_APPROVED,[\s\S]{0,900}captionsBlobPath: null,[\s\S]{0,80}transcriptBlobPath: null,/.test(svc));
  ok('  but keeps the scenes it paid for', !/inductionVideoScene\.updateMany/.test(svc));
  ok('captions and the transcript are written in the same run as the audio',
    /buildVtt\(captionScenes\)/.test(svc) && /buildTranscript\(/.test(svc));
  ok('  and a version cannot be called narrated with a scene missing its audio',
    /have no audio; narration is incomplete/.test(svc));
  ok('NARRATION_READY is only ever set with both caption paths',
    /status: InductionVideoStatus\.NARRATION_READY,[\s\S]{0,400}captionsBlobPath: vttPath,[\s\S]{0,80}transcriptBlobPath: txtPath,/.test(svc));
  ok('the speech service is resolved only when there is work to do',
    /if \(jobs\.length === 0\) return 0;/.test(svc));
  ok('media routes go through one access rule, not a hand-written copy',
    /canWorkOnVideoSite/.test(svc) && !/viewer\.siteIds\.includes/.test(svc));

  const video = read('services/inductionVideo/inductionVideoService.ts');
  ok('editing a scene clears its audio',
    /audioBlobPath: null,[\s\S]{0,120}audioDurationMs: null,[\s\S]{0,60}audioHash: null,/.test(video));
  ok('  and the captions built from the old script',
    /captionsBlobPath: null,[\s\S]{0,80}transcriptBlobPath: null,/.test(video));
  ok('  and a narrated version returns to review when edited',
    /NARRATION_READY[\s\S]{0,400}status: InductionVideoStatus\.SCRIPT_READY/.test(video));
  ok('a version cannot be edited while it is being narrated',
    /being narrated\. Wait for that to finish/.test(video));
  ok('removing a scene deletes its audio',
    /deleteMedia\(scene\.audioBlobPath\)/.test(video));

  const tick = read('app/api/system/compliance/tick/route.ts');
  ok('the existing scheduler drains narration — no second worker',
    /runQueuedNarrationJobs\(\)/.test(tick));
  ok('  and a speech outage cannot stop compliance or script generation',
    /try \{\s*\n\s*narrationsGenerated = await runQueuedNarrationJobs\(\);\s*\n\s*\} catch/.test(tick));

  /* ────────────────────────── routes and playback ────────────────────── */
  console.log('\n[8] Playback is authorised, never a public link');
  const audioRoute = read('app/api/platform/induction-video/[videoId]/audio/[sceneId]/route.ts');
  ok('the audio route checks the viewer', /getPlatformViewer\(\)/.test(audioRoute));
  ok('  scopes the scene to the version in the URL',
    /sceneAudioForViewer\(viewer, params\.videoId, params\.sceneId\)/.test(audioRoute));
  ok('  and serves ranges', /streamMedia/.test(audioRoute));
  const capRoute = read('app/api/platform/induction-video/[videoId]/captions/route.ts');
  const txtRoute = read('app/api/platform/induction-video/[videoId]/transcript/route.ts');
  ok('captions and the transcript are authorised the same way',
    /captionsForViewer/.test(capRoute) && /transcriptForViewer/.test(txtRoute));
  ok('the transcript is a download, the captions are not',
    /download: true/.test(txtRoute) && !/download: true/.test(capRoute));
  ok('no SAS link appears anywhere on the playback path',
    ![audioRoute, capRoute, txtRoute].some((r) => /mediaSasUrl|generateSasUrl/.test(r)));
  const response = read('services/inductionVideo/mediaResponse.ts');
  ok('Accept-Ranges is advertised even on a whole-file response',
    /'Accept-Ranges': 'bytes'/.test(response));
  ok('a range answers 206 with a Content-Range',
    /status: range \? 206 : 200/.test(response) && /Content-Range/.test(response));
  ok('private media is never cached', /'Cache-Control': 'private, no-store'/.test(response));

  /* ──────────────────────────── portrait ─────────────────────────────── */
  console.log('\n[9] Portrait is the primary format, by decision');
  ok('the canvas is 1080 × 1920, 9:16',
    VIDEO_FORMAT.width === 1080 && VIDEO_FORMAT.height === 1920 && VIDEO_FORMAT.aspect === '9:16');
  ok('captions are sized for a portrait screen, not a broadcast one',
    CAPTION_MAX_CHARS <= 64);
  const panel = read('components/platform/NarrationPanel.tsx');
  ok('the reviewer hears one scene at a time', /audio\n?\s*controls/.test(panel));
  ok('  and is told the cost before pressing anything',
    /costs about \{formatPence\(estimatePence\)\}/.test(panel));
  ok('  and offered the transcript and the subtitles',
    /transcript/.test(panel) && /WebVTT/.test(panel));
  const editor = read('components/platform/ScriptEditor.tsx');
  ok('the editor locks while the script is being narrated',
    /narrating = status === 'NARRATION_GENERATING'/.test(editor) &&
      /readOnly = published \|\| generating \|\| narrating/.test(editor));
  ok('  and does not offer to approve an already-narrated version',
    /const settled = approved \|\| narrating \|\| narrated;/.test(editor));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
