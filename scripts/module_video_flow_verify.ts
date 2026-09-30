export {};
/**
 * A COMPANY MODULE VIDEO, MADE ENTIRELY FROM THE MODULE PAGE.
 *
 * ── WHAT THIS SUITE IS REALLY FOR ─────────────────────────────────────────
 *
 * The old flow spanned five pages and three objects, and it could not be finished at
 * all: `revisionReadiness` asked for an uploaded file that a generated video never
 * has, so the last step refused with "This revision still needs a video file". Every
 * existing assertion passed while that was true, because each one tested a single
 * service and none walked the whole thing.
 *
 * So this walks it end to end through the REAL dispatcher — the same entry point the
 * page posts to — and asserts at every step that there is exactly one stage, one next
 * action, and no dead end. The narration and the render are the two steps that need
 * Azure Speech and ffmpeg; their completion is stood in for, exactly as
 * company_video_verify does, because what is under test is the workflow, not the
 * encoder.
 *
 * Run: npx tsx scripts/module_video_flow_verify.ts
 */
const { prisma } = require('../lib/prisma');
const { moduleVideoStage, VIDEO_STEPS } =
  require('../services/inductionVideo/moduleVideoStage');
const { handleModuleAction } = require('../services/inductionModules/moduleActions');
const { moduleActorFromPlatformViewer } =
  require('../services/inductionModules/moduleActor');
const lib = require('../services/inductionVideo/libraryAssetService');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const director = moduleActorFromPlatformViewer(
  { id: 'mvf-d', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'mvf-m', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);

const WORDING =
  'This company has been building since 1998 and every site runs the same way. '
  + 'Your supervisor is the first person to ask about anything you are unsure of. '
  + 'We would rather stop and check than carry on and guess.';

const made: string[] = [];

(async () => {
  const stamp = Date.now();
  try {
    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 1 — NOTHING WRITTEN YET');
    const mod = await prisma.inductionModule.create({
      data: { slug: `MVF_${stamp}`, title: 'Probe subject', order: 940, active: true },
      select: { id: true },
    });
    made.push(mod.id);

    let st = await moduleVideoStage(mod.id);
    chk('the stage is step 1 of 8', st.step === 1 && st.stage === 'NO_WORDING', st.label);
    chk('  and it asks for the wording', st.next?.label === 'Write the wording');
    chk('  with no production or asset invented yet',
      st.videoId === null && st.assetId === null);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 2 — A DRAFT IS NOT ENOUGH');
    const draft = await prisma.inductionModuleRevision.create({
      data: {
        moduleId: mod.id, version: 1, status: 'DRAFT', heading: 'Who we are',
        narration: WORDING, contentHash: 'h1', preparedByName: 'Probe',
      },
      select: { id: true },
    });
    st = await moduleVideoStage(mod.id);
    chk('the stage moves to step 2', st.step === 2 && st.stage === 'WORDING_DRAFT', st.label);
    chk('  and asks for it to be issued', st.next?.label === 'Issue the wording');
    chk('  which only a Director may do', st.next?.directorOnly === true);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 3 — ISSUED WORDING IS READY TO NARRATE');
    await prisma.inductionModuleRevision.update({
      where: { id: draft.id },
      data: { status: 'ISSUED', issuedAt: new Date(), issuedByName: 'Probe' },
    });
    st = await moduleVideoStage(mod.id);
    chk('the stage moves to step 3', st.step === 3 && st.stage === 'READY_TO_NARRATE', st.label);
    chk('  the one action is to generate the narration',
      st.next?.action === 'generateNarration', st.next?.label ?? '');
    chk('  and it says how long that takes',
      /30 seconds/.test(st.next?.estimate ?? ''), st.next?.estimate ?? '');
    chk('  STILL no Library asset exists — nothing is provisioned speculatively',
      st.assetId === null);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nONE PRESS: PROVISION, PRODUCE, APPROVE, QUEUE THE NARRATION');
    const refusedForManager = await handleModuleAction(manager, {
      action: 'generateNarration', moduleId: mod.id,
    });
    chk('a Site Manager is refused', refusedForManager.payload.ok === false,
      String(refusedForManager.payload.error ?? ''));

    const gen = await handleModuleAction(director, {
      action: 'generateNarration', moduleId: mod.id,
    });
    chk('a Director may', gen.payload.ok === true, String(gen.payload.error ?? ''));

    const asset = await prisma.libraryAsset.findFirst({
      where: { moduleId: mod.id },
      select: {
        id: true, slug: true, title: true, provenance: true, placement: true,
        order: true, mandatory: true, defaultIncluded: true, active: true,
      },
    });
    chk('A LIBRARY ASSET WAS PROVISIONED IN THE BACKGROUND', Boolean(asset),
      'the user never asked for one and never sees it');
    chk('  generated from this module', asset?.provenance === 'GENERATED');
    chk('  titled after the module, not a slug', asset?.title === 'Probe subject');
    chk('  in the COMPANY_BAND so the running order does not move',
      asset?.placement === 'COMPANY_BAND');
    chk('  at the module’s own order', asset?.order === 940);

    const production = await prisma.inductionVideo.findFirst({
      where: { libraryAssetId: asset?.id },
      select: { id: true, status: true, approvedAt: true, jobs: { select: { kind: true, status: true } } },
    });
    chk('a production was started', Boolean(production));
    chk('  and APPROVED without a second approval screen',
      production?.approvedAt !== null,
      'the script is the Director’s own issued wording, split by sentence');
    chk('  with a narration job queued',
      production?.jobs.some((j: { kind: string }) => j.kind === 'NARRATION') === true);

    st = await moduleVideoStage(mod.id);
    chk('the stage reads as working, still step 3',
      st.step === 3 && st.working === true && st.stage === 'NARRATING', st.label);
    chk('  with no button to press while it runs', st.next === null);
    chk('  and a videoId to poll', st.videoId === production?.id);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 4 — NARRATED, READY TO BUILD');
    // Stand in for Azure Speech: audio per scene, plus the set-level artefacts.
    await prisma.inductionVideoJob.updateMany({
      where: { videoId: production!.id }, data: { status: 'SUCCEEDED' },
    });
    for (const sc of await prisma.inductionVideoScene.findMany({
      where: { videoId: production!.id }, select: { id: true },
    })) {
      await prisma.inductionVideoScene.update({
        where: { id: sc.id },
        data: {
          audioBlobPath: `induction-video/${asset!.id}/${production!.id}/audio/x.mp3`,
          audioDurationMs: 6000,
        },
      });
    }
    await prisma.inductionVideo.update({
      where: { id: production!.id },
      data: {
        status: 'NARRATION_READY',
        narrationAt: new Date(),
        captionsBlobPath: `induction-video/${asset!.id}/${production!.id}/captions.vtt`,
        transcriptBlobPath: `induction-video/${asset!.id}/${production!.id}/transcript.txt`,
      },
    });
    st = await moduleVideoStage(mod.id);
    chk('the stage moves to step 4', st.step === 4 && st.stage === 'NARRATION_REVIEW', st.label);
    chk('  the one action is to generate the video',
      st.next?.action === 'generateVideo', st.next?.label ?? '');
    chk('  and it warns it takes a couple of minutes',
      /two minutes/.test(st.next?.estimate ?? ''), st.next?.estimate ?? '');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 5 — RENDERING');
    const rendered = await handleModuleAction(director, {
      action: 'generateVideo', videoId: production!.id,
    });
    chk('the render is queued', rendered.payload.ok === true,
      String(rendered.payload.error ?? ''));
    st = await moduleVideoStage(mod.id);
    chk('the stage reads as step 5, working',
      st.step === 5 && st.working === true && st.stage === 'RENDERING', st.label);
    chk('  with nothing to press', st.next === null);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 6 — PREVIEW');
    await prisma.inductionVideoJob.updateMany({
      where: { videoId: production!.id }, data: { status: 'SUCCEEDED' },
    });
    await prisma.inductionVideo.update({
      where: { id: production!.id },
      data: {
        status: 'VIDEO_READY',
        renderedAt: new Date(),
        videoBlobPath: `induction-video/${asset!.id}/${production!.id}/video-x.mp4`,
        videoDurationMs: 18_000,
      },
    });
    st = await moduleVideoStage(mod.id);
    chk('the stage moves to step 6', st.step === 6 && st.stage === 'PREVIEW', st.label);
    chk('  and the one action is Publish & issue',
      st.next?.action === 'publishAndIssue' && st.next?.label === 'Publish & issue');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 7 — PUBLISH AND ISSUE ARE ONE ACT');
    const noNote = await handleModuleAction(director, {
      action: 'publishAndIssue', videoId: production!.id, issueNote: '',
    });
    chk('it insists on a note for the record', noNote.payload.ok === false,
      String(noNote.payload.error ?? ''));

    const live = await handleModuleAction(director, {
      action: 'publishAndIssue',
      videoId: production!.id,
      issueNote: 'First version, read from the issued wording.',
    });
    chk('ONE PRESS PUBLISHES AND ISSUES', live.payload.ok === true,
      String(live.payload.error ?? ''));

    const rev = await prisma.libraryAssetRevision.findFirst({
      where: { assetId: asset!.id },
      select: { status: true, issuedAt: true, issueNote: true, normalisedBlobPath: true },
    });
    chk('  the revision is ISSUED, not left as a draft to find later',
      rev?.status === 'ISSUED' && rev?.issuedAt !== null,
      'the old flow filed a draft and told nobody');
    chk('  the note is on the record', rev?.issueNote?.startsWith('First version') === true);
    chk('  and the rendered film IS the segment',
      rev?.normalisedBlobPath?.includes('video-x.mp4') === true);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTEP 8 — LIVE');
    st = await moduleVideoStage(mod.id);
    chk('THE STAGE IS LIVE, step 8 of 8', st.step === 8 && st.stage === 'LIVE', st.label);
    chk('  it reports itself as live', st.live === true);
    chk('  and there is nothing left to do', st.next === null);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nRE-ISSUING THE WORDING MAKES THE VIDEO STALE, AND SAYS SO');
    const newRev = await prisma.inductionModuleRevision.create({
      data: {
        moduleId: mod.id, version: 2, status: 'ISSUED', heading: 'Who we are',
        narration: `${WORDING} We have changed this paragraph.`, contentHash: 'h2',
        preparedByName: 'Probe', issuedAt: new Date(), issuedByName: 'Probe',
      },
      select: { id: true },
    });
    await prisma.inductionModuleRevision.update({
      where: { id: draft.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    st = await moduleVideoStage(mod.id);
    chk('the stage says the video says older words',
      st.stage === 'LIVE_WORDING_MOVED_ON', st.label);
    chk('  it is still live in the meantime', st.live === true);
    chk('  and offers to generate again',
      st.next?.action === 'generateNarration', st.next?.label ?? '');
    chk('  warning that operatives see the older words until then',
      /older words/.test(st.detail), st.detail);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nNO DEAD ENDS, AND ONE VOCABULARY');
    chk('the eight steps are the ones the owner asked for',
      JSON.stringify(VIDEO_STEPS) === JSON.stringify([
        'Write wording', 'Issue wording', 'Generate narration', 'Review narration',
        'Generate video', 'Preview video', 'Publish & issue', 'Live',
      ]), VIDEO_STEPS.join(' > '));

    // A regenerate resumes rather than refusing: startCompanyVideo allows only one
    // production in flight, so "try again" would otherwise be a dead end.
    const again = await handleModuleAction(director, {
      action: 'generateNarration', moduleId: mod.id,
    });
    chk('generating again after a re-issue is not refused', again.payload.ok === true,
      String(again.payload.error ?? ''));
    const productions = await prisma.inductionVideo.count({
      where: { libraryAssetId: asset!.id },
    });
    chk('  and it did not start a second competing production', productions === 2,
      `${productions} productions: the published one, and the new one`);

    console.log('\nTHE SOURCE SAYS WHAT IT DOES');
    const svc = read('services/inductionVideo/moduleVideoStage.ts');
    chk('the stage is derived, never stored',
      !/videoStage\s+String/.test(read('prisma/schema.prisma')),
      'a stored stage would be a fifth source of truth');
    chk('it explains why narration also produces and approves',
      /WHY "GENERATE THE NARRATION" ALSO PRODUCES AND APPROVES/.test(svc));
    /*
     * COMMENT-STRIPPED, and only the JSX TEXT. The comments in that file discuss
     * assets, productions and revisions at length on purpose — explaining why they are
     * hidden is not the same as showing them — so a plain grep flagged its own
     * rationale. The same trap cost a build earlier in this work.
     */
    const panelText = read('components/inductionModules/ModuleWorkflowCard.tsx')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const hidden of ['LibraryAsset', 'revision', 'production', 'asset']) {
      chk(`the panel never says "${hidden}" to the user`,
        !new RegExp(`>[^<{}]*\\b${hidden}`, 'i').test(panelText),
        'assets, productions and revisions are implementation detail');
    }
  } finally {
    // Assets cascade their revisions and productions; the module cascades its wording.
    await prisma.libraryAsset.deleteMany({ where: { moduleId: { in: made } } });
    await prisma.inductionModule.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
