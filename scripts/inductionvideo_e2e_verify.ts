export {};
/** Phase 1 end to end against the local DB, with a stubbed model. */
process.env.AI_PROVIDER = 'mock';
const stubPath = require.resolve('../services/ai/aiConfigService');
const realCfg = require(stubPath);
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true,
  exports: { ...realCfg, resolveAiProvider: async () => ({
    name: 'stub',
    complete: async (input: any) => ({
      text: '', model: 'stub-1',
      json: { scenes: JSON.parse(input.user).scenes.map((s: any) => ({
        sceneType: s.sceneType,
        narration: `Narration for ${s.heading}. ${s.facts.join(' ')}`,
      })) },
      tokensPrompt: 1200, tokensOutput: 400,
    }) }) } } as never;

const { prisma } = require('../lib/prisma');
const { videoActorFromPlatformViewer } = require('../services/inductionVideo/videoActor');
const svc = require('../services/inductionVideo/inductionVideoService');
let fails = 0; const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  const snap = {
    site: await prisma.jobSite.findUnique({ where: { id: site.id }, select: { fireAssemblyPoint: true, firstAiderName: true, firstAiderLocation: true } }),
    info: await prisma.siteInformation.findUnique({ where: { jobSiteId: site.id } }),
    risks: await prisma.siteRiskTopic.findMany({ where: { jobSiteId: site.id } }),
  };
  /*
   * Through the SAME adapter the routes use. The services take a decided
   * capability now, not a viewer, because company-wide admins and site-scoped
   * platform users both drive this workflow - hand-building an actor here would
   * test a fiction, and passing a bare viewer fails with "maySite is not a
   * function", which is how this suite caught the conversion.
   */
  const directorViewer = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [site.id] };
  const pmViewer = { id: 'u2', name: 'Pat Manager', role: 'PROJECT_MANAGER', siteIds: [site.id] };
  const director = videoActorFromPlatformViewer(directorViewer as never);
  const pm = videoActorFromPlatformViewer(pmViewer as never);
  try {
    // 1. Blocked: asbestos applies with no controls.
    await prisma.jobSite.update({ where: { id: site.id }, data: { fireAssemblyPoint: 'Rear car park', firstAiderName: 'Fay Aid', firstAiderLocation: 'Site office' } });
    await prisma.siteInformation.upsert({ where: { jobSiteId: site.id },
      update: { emergencyProcedures: 'Stop work, make equipment safe, go to the assembly point.' },
      create: { jobSiteId: site.id, emergencyProcedures: 'Stop work, make equipment safe, go to the assembly point.' } });
    await prisma.siteRiskTopic.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.siteRiskTopic.create({ data: { jobSiteId: site.id, topic: 'ASBESTOS', applicable: true, controls: null } });

    const blocked = await svc.requestScript(director, site.id);
    const blockedVideo = await prisma.inductionVideo.findUnique({ where: { id: blocked.value.videoId } });
    chk('asbestos with no controls: the version records INFORMATION_REQUIRED',
      blockedVideo.status === 'INFORMATION_REQUIRED', blockedVideo.status);
    chk('  naming the gap for the manager',
      JSON.stringify(blockedVideo.blockingReasons).includes('control measures'));
    chk('  and no job was queued', (await prisma.inductionVideoJob.count({ where: { videoId: blockedVideo.id } })) === 0);

    // 2. Fix the data, generate for real.
    await prisma.siteRiskTopic.updateMany({ where: { jobSiteId: site.id, topic: 'ASBESTOS' },
      data: { controls: 'Do not disturb any suspect material. Report it to the site manager.' } });
    const req = await svc.requestScript(pm, site.id);
    chk('a Project Manager may request a script', req.ok === true, req.ok ? '' : req.error);
    const videoId = req.value.videoId;
    chk('  the version is SCRIPT_GENERATING with a queued job',
      (await prisma.inductionVideo.findUnique({ where: { id: videoId } })).status === 'SCRIPT_GENERATING' &&
      (await prisma.inductionVideoJob.count({ where: { videoId, status: 'QUEUED' } })) === 1);
    const ran = await svc.runQueuedScriptJobs();
    chk('the scheduler runs the job', ran >= 1, `${ran} job(s)`);
    const after = await prisma.inductionVideo.findUnique({ where: { id: videoId }, include: { scenes: { orderBy: { order: 'asc' } } } });
    chk('  producing a script ready for review', after.status === 'SCRIPT_READY', after.status);
    chk('  with the asbestos scene, marked required',
      after.scenes.some((s: any) => s.sceneType === 'ASBESTOS' && s.required));
    chk('  narration carries the recorded control, not an invention',
      after.scenes.find((s: any) => s.sceneType === 'ASBESTOS').narration.includes('Do not disturb'));
    chk('  and the cost was recorded',
      (await prisma.aiUsageEvent.count({ where: { videoId, purpose: 'script' } })) === 1);

    // 3. Approval rules.
    const pmApprove = await svc.approveScript(pm, videoId);
    chk('a Project Manager may NOT approve', pmApprove.ok === false, pmApprove.ok ? '' : pmApprove.error);
    const required = after.scenes.find((s: any) => s.required);
    const del = await svc.removeScene(director, required.id);
    chk('a required scene cannot be removed', del.ok === false, del.ok ? '' : del.error);
    const optional = after.scenes.find((s: any) => !s.required);
    if (optional) chk('an optional one can be', (await svc.removeScene(director, optional.id)).ok === true);
    const approved = await svc.approveScript(director, videoId);
    chk('a Director approves', approved.ok === true, approved.ok ? '' : approved.error);
    const edit = await svc.editScene(director, required.id, 'A corrected narration for this required scene.');
    chk('editing after approval withdraws the approval',
      edit.ok === true &&
      (await prisma.inductionVideo.findUnique({ where: { id: videoId } })).status === 'SCRIPT_READY' &&
      (await prisma.inductionVideo.findUnique({ where: { id: videoId } })).approvedAt === null);

    // 4. Versioning + supersede + audit.
    await svc.approveScript(director, videoId);
    const v2 = await svc.requestScript(director, site.id);
    await svc.runQueuedScriptJobs();
    chk('the next version is version 2', v2.value.version === 2);
    const superseded = await svc.supersedeEarlierVersions(site.id, v2.value.videoId, director);
    chk('earlier versions are superseded, not deleted',
      superseded >= 1 && (await prisma.inductionVideo.findUnique({ where: { id: videoId } })).supersededAt !== null);
    chk('  and are still there to read', (await prisma.inductionVideo.count({ where: { jobSiteId: site.id } })) === 2);
    const blockedStill = await prisma.inductionVideo.findUnique({ where: { id: blockedVideo.id } });
    chk('the blocked attempt was REUSED, not left as a dead version',
      blockedStill.version === 1 && blockedStill.status !== 'INFORMATION_REQUIRED' && blockedStill.blockingReasons === null,
      `v${blockedStill.version} ${blockedStill.status} reasons=${JSON.stringify(blockedStill.blockingReasons)}`);
    const events = await prisma.inductionVideoEvent.findMany({ where: { videoId }, select: { action: true } });
    chk('the trail records the whole life of the version',
      ['SCRIPT_REQUESTED', 'SCRIPT_GENERATED', 'SCRIPT_APPROVED', 'APPROVAL_WITHDRAWN', 'SUPERSEDED']
        .every((a) => events.some((e: any) => e.action === a)), events.map((e: any) => e.action).join(' → '));

    // 5. Staleness.
    const list = await svc.listVideosForSite(director, site.id);
    chk('a fresh version is not stale', list.find((v: any) => v.id === v2.value.videoId).stale === false);
    await prisma.siteInformation.update({ where: { jobSiteId: site.id }, data: { emergencyProcedures: 'Stop work and call the site manager immediately.' } });
    const after2 = await svc.listVideosForSite(director, site.id);
    chk('changing the site data marks it stale', after2.find((v: any) => v.id === v2.value.videoId).stale === true);
  } catch (e: any) { console.log('  ERROR ' + e.message); fails++; }
  finally {
    const vids = await prisma.inductionVideo.findMany({ where: { jobSiteId: site.id }, select: { id: true } });
    await prisma.inductionVideo.deleteMany({ where: { id: { in: vids.map((v: any) => v.id) } } });
    await prisma.aiUsageEvent.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.siteRiskTopic.deleteMany({ where: { jobSiteId: site.id } });
    if (snap.risks.length) await prisma.siteRiskTopic.createMany({ data: snap.risks });
    await prisma.jobSite.update({ where: { id: site.id }, data: snap.site });
    if (snap.info) { const { jobSiteId, createdAt, updatedAt, ...rest } = snap.info; await prisma.siteInformation.update({ where: { jobSiteId: site.id }, data: rest }); }
    else await prisma.siteInformation.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
