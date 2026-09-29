export {};
/**
 * THE PAGE UPDATES ITSELF, AND POLLING DOES NOT BREAK IT.
 *
 * ── WHAT WENT WRONG IN PRODUCTION (2026-09-29, SC-E-00009) ────────────────
 *
 * The version page polled by calling `router.refresh()` every three seconds, which
 * re-renders the whole page on the server. A render takes 123 seconds and ffmpeg runs
 * IN THE SAME PROCESS on one small instance, so about forty heavy renders queued
 * behind and competed with the encode. The streamed React payload was truncated and
 * the client threw `TypeError: Error in input stream` three times, which trips the
 * error boundary. Automatic updating was crashing the page it was refreshing, and the
 * panels told people to reload - onto the same overloaded instance.
 *
 * THE PROPERTIES:
 *   CHEAP QUESTION      a poll is a small JSON read, never a page render.
 *   REFRESH ON CHANGE   the page re-renders only when something it shows changed.
 *   IT NOTICES EVERYTHING it shows: a scene narrated, a render finished, a job failed.
 *   AUTHORITY UNCHANGED a poll cannot reveal a version its viewer could not open.
 *   IT BACKS OFF        a two-minute render is not polled on a three-second beat.
 *   A FAILED POLL       is a reason to try again, never to throw.
 *   THE ENCODE YIELDS   ffmpeg is deprioritised so the page keeps its CPU slice.
 *
 * Run: npx tsx scripts/video_progress_verify.ts
 */
const { prisma } = require('../lib/prisma');
const progress = require('../services/inductionVideo/progressService');
const vp = require('../services/inductionVideo/videoProgress');
const cvs = require('../services/inductionVideo/companyVideoService');
const lib = require('../services/inductionVideo/libraryAssetService');
const mod = require('../services/inductionModules/inductionModuleService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { videoActorFromModuleActor } = require('../services/inductionVideo/videoActor');
const { deprioritiseEncode, ENCODE_PRIORITY } =
  require('../services/inductionVideo/childPriority');
const { readFileSync } = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const director = moduleActorFromPlatformViewer(
  { id: 'vpv', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const vActor = videoActorFromModuleActor(director);

const SLUG = 'VPV_ASSET';
const MOD_SLUG = 'VPV_MODULE';
const WORDING =
  'Welcome to the company. Every person here is responsible for their own safety.\n\n' +
  'If you see something unsafe, stop and say so. Nobody is criticised for raising a concern.';

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
  await prisma.inductionModule.deleteMany({ where: { slug: MOD_SLUG } });
  try {
    const row = await prisma.inductionModule.create({
      data: { slug: MOD_SLUG, title: 'Company introduction', order: 91 },
    });
    const draft = await mod.startDraft(director, row.id);
    await mod.saveDraft(director, draft.value.revisionId,
      { heading: 'Company introduction', narration: WORDING });
    await mod.issueRevision(director, draft.value.revisionId, 'for the suite');

    const asset = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'Company Introduction', placement: 'OPENING',
      provenance: 'GENERATED', moduleId: row.id,
    });
    const assetId = asset.value.assetId;
    const started = await cvs.startCompanyVideo(vActor, assetId);
    chk('a company production can be started', started.ok === true, started.error ?? '');
    const videoId = started.value.videoId;

    console.log('\nTHE POLL ANSWERS THE QUESTION THE BANNER ASKS');
    const first = await progress.videoProgress(vActor, videoId);
    chk('it answers for a company video', first !== null);
    chk('  SCRIPT_READY is not "working"', first.working === false,
      'a resting state a person must act on must not sit behind a spinner');
    chk('  so there is nothing to say about it', first.label === null);
    chk('  and it carries a fingerprint', typeof first.fingerprint === 'string' &&
      first.fingerprint.length > 0);

    const unchanged = await progress.videoProgress(vActor, videoId);
    chk('ASKING TWICE WITH NOTHING CHANGED GIVES THE SAME FINGERPRINT',
      unchanged.fingerprint === first.fingerprint,
      // If this drifted the page would re-render on every single poll, which is the
      // load that crashed production.
      'an unstable fingerprint would re-render the page on every tick');

    console.log('\nIT NOTICES EVERY STEP OF THE WORKFLOW');
    const seen = new Set<string>([first.fingerprint]);
    const step = async (what: string, mutate: () => Promise<unknown>) => {
      await mutate();
      const p = await progress.videoProgress(vActor, videoId);
      chk(`  ${what} changes it`, !seen.has(p.fingerprint), p.fingerprint);
      seen.add(p.fingerprint);
      return p;
    };

    await step('approving the script', () => prisma.inductionVideo.update({
      where: { id: videoId }, data: { status: 'SCRIPT_APPROVED' },
    }));

    const narrating = await step('narration starting', () => prisma.inductionVideo.update({
      where: { id: videoId }, data: { status: 'NARRATION_GENERATING' },
    }));
    chk('  and NARRATION_GENERATING reads as working', narrating.working === true);
    chk('    naming the step', narrating.label === 'Recording the narration', narrating.label);

    // THE ONE THAT MATTERS MOST for "it feels alive": narration lands a scene at a
    // time, and the panel shows each scene's length as it arrives.
    const scenes = await prisma.inductionVideoScene.findMany({
      where: { videoId }, orderBy: { order: 'asc' }, select: { id: true },
    });
    chk('the production has more than one scene', scenes.length > 1, `${scenes.length}`);
    for (const [i, s] of scenes.entries()) {
      await step(`  scene ${i + 1} of ${scenes.length} being narrated`, () =>
        prisma.inductionVideoScene.update({
          where: { id: s.id }, data: { audioDurationMs: 2000 + i * 500 },
        }));
    }

    await step('the narration finishing', () => prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: 'NARRATION_READY', narrationAt: new Date(), narrationDurationMs: 9500,
        captionsBlobPath: 'x/captions.vtt', transcriptBlobPath: 'x/transcript.txt',
      },
    }));

    const rendering = await step('the render starting', () => prisma.inductionVideo.update({
      where: { id: videoId }, data: { status: 'VIDEO_GENERATING' },
    }));
    chk('  and VIDEO_GENERATING reads as working', rendering.working === true);
    chk('    naming the step', rendering.label === 'Rendering the video', rendering.label);

    const job = await prisma.inductionVideoJob.create({
      data: { videoId, kind: 'RENDER', status: 'RUNNING' },
    });
    await step('a job row appearing', async () => job);
    await step('THAT JOB FAILING', () => prisma.inductionVideoJob.update({
      where: { id: job.id }, data: { status: 'FAILED', error: 'ffmpeg exited 1' },
    }));
    // A failure is why job rows are in the fingerprint at all: the status a failed
    // job never got to write cannot be what tells the screen about it.

    const failed = await progress.videoProgress(vActor, videoId);
    chk('GENERATION_FAILED is NOT treated as working',
      vp.isWorkingStatus('GENERATION_FAILED') === false,
      'polling a failure forever would hide it behind a spinner');
    chk('  (the version is still mid-render until something says otherwise)',
      failed.working === true);

    await step('the render finishing', () => prisma.inductionVideo.update({
      where: { id: videoId },
      data: {
        status: 'VIDEO_READY', renderedAt: new Date(), videoBlobPath: 'x/video.mp4',
        videoDurationMs: 28064, renderEngine: 'ffmpeg',
      },
    }));
    const done = await progress.videoProgress(vActor, videoId);
    chk('  and it stops being "working", which is what ends the polling',
      done.working === false && done.label === null);

    await step('publishing it', () => prisma.inductionVideo.update({
      where: { id: videoId }, data: { status: 'PUBLISHED', publishedAt: new Date() },
    }));

    chk(`every step produced a distinct fingerprint`, seen.size >= 10, `${seen.size} states`);

    console.log('\nA POLL CANNOT REVEAL WHAT ITS VIEWER COULD NOT OPEN');
    chk('a company video needs company authority',
      (await progress.videoProgress({ ...vActor, canManage: false }, videoId)) === null,
      'the same guard the page used to render it');
    chk('  and project authority is NOT company authority',
      (await progress.videoProgress(
        { ...vActor, canManage: false, maySite: () => true }, videoId)) === null,
      'a different question with a different answer');
    chk('an unknown version is not found',
      (await progress.videoProgress(vActor, 'no-such-video')) === null);
    chk('a project poll refuses a project the actor may not see',
      (await progress.siteProgress({ ...vActor, maySite: () => false }, 'any-site')) === null);

    console.log('\nTHE BEAT SLOWS AS THE WAIT LENGTHENS');
    chk('it starts responsive', vp.workPollDelayMs(0) === 3_000);
    chk('  still responsive while a script could be finishing',
      vp.workPollDelayMs(29_000) === 3_000);
    chk('  eases off once it is clearly a longer job',
      vp.workPollDelayMs(31_000) === 5_000);
    chk('  and further into a render', vp.workPollDelayMs(121_000) === 10_000);
    chk('  never faster than it started',
      [0, 1_000, 45_000, 200_000, 600_000].every((e) => vp.workPollDelayMs(e) >= 3_000));
    /*
     * THE MEASURED RENDER WAS 123 SECONDS. Counting polls over it, with the honest
     * framing: the back-off trims the chatter (41 ticks on the old fixed beat, 29
     * now), but that is the SMALL half of the fix. The large half is that a tick is
     * now a small JSON read instead of a whole-page server render, and the page is
     * re-rendered only when the fingerprint moves - once, when the render lands.
     * An earlier version of this assertion claimed "~25 polls, not 41" as though the
     * count were the point; it is not, and it was wrong about the count too.
     */
    let polls = 0;
    for (let t = 0; t < 123_000; t += vp.workPollDelayMs(t)) polls++;
    let oldPolls = 0;
    for (let t = 0; t < 123_000; t += vp.WORK_POLL_INTERVAL_MS) oldPolls++;
    chk(`the back-off trims the chatter: ${polls} ticks against ${oldPolls} on a fixed beat`,
      polls < oldPolls, `${polls} vs ${oldPolls}`);
    /*
     * On the SUCCESS path - a poll that came back fine - the only refresh must be the
     * one guarded by `changed`. Scoped to that slice because there is a second,
     * deliberate refresh earlier for an expired session (401/403), which sends the
     * person to sign in; a blanket "no refresh before the comparison" assertion
     * tripped on it and was wrong, not the code.
     */
    const pollerSrc = code('components/inductionVideo/RefreshWhileWorking.tsx');
    const successPath = pollerSrc.slice(
      pollerSrc.indexOf('failures.current = 0;'),
      pollerSrc.indexOf('} catch {'),
    );
    chk('  and a successful tick with nothing changed renders nothing',
      successPath.includes('if (changed') &&
        successPath.indexOf('if (changed') < successPath.indexOf('router.refresh()') &&
        (successPath.match(/router\.refresh\(\)/g) ?? []).length === 1,
      'an unguarded refresh here would make every tick a page render again');

    console.log('\nTHE PAGE IS RE-RENDERED ONLY WHEN SOMETHING CHANGED');
    const poller = code('components/inductionVideo/RefreshWhileWorking.tsx');
    chk('the poller fetches the status endpoint', /fetch\(statusHref/.test(poller));
    chk('  and compares fingerprints',
      /fingerprint\.current !== json\.fingerprint/.test(poller));
    chk('  refreshing only when they differ',
      /if \(changed && !refreshing\.current\) \{\s*refreshing\.current = true;\s*router\.refresh\(\);/
        .test(poller),
      // The old code called router.refresh() on every tick. That is the defect.
      'an unconditional refresh is the load that truncated the stream');
    chk('  and it does NOT refresh on a plain tick',
      !/setInterval\([\s\S]{0,120}router\.refresh\(\)/.test(poller),
      'the old shape: a timer whose body was a page render');
    chk('a failed poll is caught, not thrown',
      /\} catch \{/.test(poller) && /failures\.current \+= 1;/.test(poller),
      'an unhandled rejection here would put the page on the error screen for a blip');
    chk('a lost session sends the person to sign in rather than counting failures',
      /res\.status === 401 \|\| res\.status === 403/.test(poller));
    chk('the component requires a status endpoint',
      /statusHref: string;/.test(poller),
      'optional would let a caller silently keep the old whole-page behaviour');

    console.log('\nEVERY SCREEN THAT POLLS PASSES ONE');
    for (const f of [
      'components/inductionVideo/VideoVersionSurface.tsx',
      'app/platform/dashboard/sites/[id]/induction-video/page.tsx',
      'app/admin/(dashboard)/induction-videos/projects/[id]/page.tsx',
    ]) {
      const src = code(f);
      chk(`${f.split('/').pop()} mounts it with a statusHref`,
        /<RefreshWhileWorking[\s\S]{0,260}?statusHref=/.test(src));
    }
    for (const r of [
      'app/api/platform/induction-video/[videoId]/status/route.ts',
      'app/api/admin/induction-video/[videoId]/status/route.ts',
      'app/api/platform/sites/[id]/induction-video/status/route.ts',
      'app/api/admin/sites/[id]/induction-video/status/route.ts',
    ]) {
      const src = code(r);
      chk(`${r.replace('app/api/', '')} exists and is a GET`,
        /export async function GET/.test(src));
      chk(`  and asks the shared progress service`,
        /videoProgress\(|siteProgress\(/.test(src),
        'a route computing its own answer is a second definition of "working"');
    }

    console.log('\nNOBODY IS TOLD TO REFRESH ANY MORE');
    for (const f of ['components/platform/RenderPanel.tsx',
                     'components/platform/NarrationPanel.tsx']) {
      chk(`${f.split('/').pop()} no longer instructs a manual refresh`,
        !/refresh to see/i.test(read(f)),
        'the instruction that led somebody to reload a page mid-render');
      chk(`  and says it updates by itself`,
        /updates by itself|appears here as it is recorded/i.test(read(f)));
    }

    console.log('\nTHE ENCODE YIELDS TO THE PAGE');
    chk('the lowest priority is what is asked for', ENCODE_PRIORITY === os.constants.priority.PRIORITY_LOW);
    const child = spawn('sleep', ['2']);
    const applied = deprioritiseEncode(child.pid);
    chk('deprioritising a real child process works here', applied === true);
    if (applied) {
      chk('  and it actually took effect', os.getPriority(child.pid) === ENCODE_PRIORITY,
        `nice ${os.getPriority(child.pid)}`);
    }
    child.kill();
    chk('a missing pid is handled rather than thrown at',
      deprioritiseEncode(undefined) === false);
    for (const f of ['services/inductionVideo/ffmpegRenderer.ts',
                     'services/inductionVideo/libraryNormaliser.ts']) {
      chk(`${f.split('/').pop()} deprioritises what it spawns`,
        /deprioritiseEncode\(child\.pid\)/.test(code(f)),
        'ffmpeg and the page share one CPU on the production instance');
    }

    console.log('\nTHE POLL IS CHEAP — IT MUST NOT GROW INTO A PAGE RENDER');
    const svc = code('services/inductionVideo/progressService.ts');
    for (const heavy of ['viewsForVideo', 'spendForVideo', 'overriddenRevisionIds',
                         'estimateNarration', 'manifestForSite', 'getVideo(']) {
      chk(`  it does not call ${heavy}`, !svc.includes(heavy),
        'the whole point is that a poll costs almost nothing');
    }
    chk('  it selects no events', !/events:/.test(svc),
      'fifty audit rows per poll is exactly the weight being removed');
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: SLUG } });
    await prisma.inductionModule.deleteMany({ where: { slug: MOD_SLUG } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
