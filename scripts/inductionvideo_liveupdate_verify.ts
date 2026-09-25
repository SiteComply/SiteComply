export {};
/**
 * A page keeps itself current while a job runs — in both tiers.
 *
 * THE BUG: generating a script queues a job that starts immediately and finishes
 * in seconds, but the page was rendered before it finished, so the new version
 * only appeared on a manual reload. People read that as "nothing happened".
 *
 * THE PROPERTIES THAT MATTER:
 *  - the transient statuses, and only those, count as work in flight. Including
 *    GENERATION_FAILED would poll a failure forever and hide it; excluding one of
 *    the three would leave that screen stale, which is the original bug;
 *  - polling STOPS when the work does, without anything deciding to stop it: the
 *    server recomputes `working`, the effect tears down;
 *  - all four screens — both tiers' project pages and both tiers' version pages —
 *    use the same component and the same definition, so none can drift into
 *    staleness on its own;
 *  - there is a ceiling, because a job that dies without writing a failure leaves
 *    the status transient forever.
 *
 * Run: npx tsx scripts/inductionvideo_liveupdate_verify.ts
 */
const prog = require('../services/inductionVideo/videoProgress');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const COMP = 'components/inductionVideo/RefreshWhileWorking.tsx';
const SURFACE = 'components/inductionVideo/VideoVersionSurface.tsx';
const PLAT_PROJECT = 'app/platform/dashboard/sites/[id]/induction-video/page.tsx';
const ADMIN_PROJECT = 'app/admin/(dashboard)/induction-videos/projects/[id]/page.tsx';
const PLAT_VERSION = 'app/platform/dashboard/induction-videos/[videoId]/page.tsx';
const ADMIN_VERSION = 'app/admin/(dashboard)/induction-videos/[videoId]/page.tsx';

console.log('\nWHICH STATES COUNT AS WORK IN FLIGHT');
for (const s of ['SCRIPT_GENERATING', 'NARRATION_GENERATING', 'VIDEO_GENERATING']) {
  chk(`${s} is work in flight`, prog.isWorkingStatus(s) === true);
}
for (const s of ['SCRIPT_READY', 'SCRIPT_APPROVED', 'NARRATION_READY', 'VIDEO_READY',
                 'PUBLISHED', 'DRAFT', 'INFORMATION_REQUIRED']) {
  chk(`${s} is settled`, prog.isWorkingStatus(s) === false);
}
chk(
  'GENERATION_FAILED is settled, not work in flight',
  prog.isWorkingStatus('GENERATION_FAILED') === false,
  'polling a failure forever would hide it behind a spinner',
);
chk('an unknown status is settled, not spun on', prog.isWorkingStatus('WHATEVER') === false);

console.log('\nWHAT THE PERSON IS TOLD');
chk('a script names the step', prog.describeWork('SCRIPT_GENERATING') === 'Writing the script');
chk('narration names the step', prog.describeWork('NARRATION_GENERATING') === 'Recording the narration');
chk('a render names the step', prog.describeWork('VIDEO_GENERATING') === 'Rendering the video');
chk('a settled version says nothing', prog.describeWork('SCRIPT_READY') === null);

console.log('\nPROJECT-LEVEL ROLL-UP');
chk('no versions is not working', prog.anyWorking([]) === false);
chk('a settled version is not working',
  prog.anyWorking([{ status: 'SCRIPT_READY' }]) === false);
chk('one generating version among settled ones IS working',
  prog.anyWorking([{ status: 'PUBLISHED' }, { status: 'SCRIPT_GENERATING' }]) === true);
chk('and the roll-up names that step',
  prog.describeAnyWork([{ status: 'PUBLISHED' }, { status: 'VIDEO_GENERATING' }]) ===
    'Rendering the video');
chk('a settled project describes nothing',
  prog.describeAnyWork([{ status: 'PUBLISHED' }]) === null);

console.log('\nTHE POLLING STOPS BY ITSELF');
const comp = read(COMP);
chk('it is a client component', /^'use client';/.test(comp));
chk(
  'the effect does nothing when not working',
  /if \(!working\)/.test(comp),
  'the server flipping `working` to false is what ends the polling',
);
chk('the interval is cleared on teardown', /clearInterval\(id\)/.test(comp));
chk('the focus listener is removed on teardown', /removeEventListener\('focus'/.test(comp));
chk('it refreshes on tab focus', /addEventListener\('focus'/.test(comp));
chk(
  'it renders nothing at all when settled',
  /if \(!working\) return null;/.test(comp),
  'no leftover banner on a finished version',
);
chk(
  'there is a ceiling on how long it polls',
  /WORK_POLL_CEILING_MS/.test(comp) && prog.WORK_POLL_CEILING_MS > 0,
  `${prog.WORK_POLL_CEILING_MS}ms`,
);
chk(
  'the ceiling is generous enough for a render',
  prog.WORK_POLL_CEILING_MS >= 5 * 60 * 1000,
  'a measured render has taken about a minute and a half',
);
chk(
  'the interval feels immediate but is not a hammer',
  prog.WORK_POLL_INTERVAL_MS >= 1_000 && prog.WORK_POLL_INTERVAL_MS <= 5_000,
  `${prog.WORK_POLL_INTERVAL_MS}ms`,
);
chk('it says the page updates on its own', /updates on its own/.test(comp));
chk('it is announced to assistive technology', /aria-live="polite"/.test(comp));
chk('it offers a manual check as well', /Check now/.test(comp));

console.log('\nALL FOUR SCREENS, ONE COMPONENT');
for (const [label, f] of [
  ['the shared version surface', SURFACE],
  ['the Platform project page', PLAT_PROJECT],
  ['the Admin project page', ADMIN_PROJECT],
] as const) {
  /*
   * As a RENDERED ELEMENT, not a mention. A mutation that deleted the JSX but left
   * the import passed the first version of this check - which would have shipped a
   * page that imports a refresher and never mounts it.
   */
  chk(`${label} renders it`, /<RefreshWhileWorking\b/.test(read(f)));
}
chk(
  'both version pages get it through the shared surface',
  /VideoVersionSurface/.test(read(PLAT_VERSION)) &&
    /VideoVersionSurface/.test(read(ADMIN_VERSION)) &&
    /<RefreshWhileWorking\b/.test(read(SURFACE)),
  'wiring it per tier would be two places to forget',
);
chk(
  'neither project page defines its own idea of "working"',
  !/SCRIPT_GENERATING|NARRATION_GENERATING|VIDEO_GENERATING/.test(read(PLAT_PROJECT)) &&
    !/SCRIPT_GENERATING|NARRATION_GENERATING|VIDEO_GENERATING/.test(read(ADMIN_PROJECT)),
  'a fourth definition is a fourth chance to be stale',
);
chk(
  'both project pages ask the shared roll-up',
  /anyWorking\(videos\)/.test(read(PLAT_PROJECT)) &&
    /anyWorking\(videos\)/.test(read(ADMIN_PROJECT)),
);
chk(
  'only one file names the transient statuses',
  ['services/inductionVideo/videoProgress.ts', COMP, SURFACE, PLAT_PROJECT, ADMIN_PROJECT]
    .filter((f) => /InductionVideoStatus\.SCRIPT_GENERATING/.test(read(f))).length === 1,
);

console.log('\nTHE WORK STILL STARTS IMMEDIATELY');
chk(
  'requesting a script kicks the queue rather than waiting for the tick',
  /kickInductionJobs\(\);/.test(read('services/inductionVideo/inductionVideoService.ts')),
  'refreshing quickly is pointless if the job has not started',
);
chk('the generate button still refreshes once on success',
  /router\.refresh\(\)/.test(read('components/platform/GenerateScriptButton.tsx')),
  'that first refresh is what makes the generating state - and so the polling - appear');

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
