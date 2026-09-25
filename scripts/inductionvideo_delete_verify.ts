export {};
/**
 * Deleting an induction script version.
 *
 * THE PROPERTIES THAT MATTER:
 *  - only the pre-workflow statuses, and STATUS ALONE IS NOT THE GUARD: editing a
 *    scene on an approved version sends it back to SCRIPT_READY while the other
 *    scenes keep their audio, so a "ready" version can be carrying media;
 *  - never published (checked on the status too, because withdrawal clears
 *    publishedAt), never watched, never superseded, nothing in flight;
 *  - deleting is a Director's or Site Manager's - an Admin OWNER/ADMIN being their
 *    equivalent - because it cannot be undone;
 *  - media is removed BEFORE the row, so a failure orphans nothing;
 *  - spend SURVIVES: a discarded draft still counts against the daily cap, or
 *    deleting would be a way to buy past the budget guard;
 *  - the button and the refusal ask the same predicate.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/inductionvideo_delete_verify.ts
 */
const { prisma } = require('../lib/prisma');
const svc = require('../services/inductionVideo/inductionVideoService');
const { videoActorFromPlatformViewer, videoActorFromAdmin } =
  require('../services/inductionVideo/videoActor');
const { handleVideoAction } = require('../services/inductionVideo/videoActions');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const site = await prisma.jobSite.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  if (!site) { console.log('  no active site to test against'); process.exit(1); }

  const director = videoActorFromPlatformViewer(
    { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [site.id] } as never);
  const pm = videoActorFromPlatformViewer(
    { id: 'u2', name: 'Pat PM', role: 'PROJECT_MANAGER', siteIds: [site.id] } as never);
  const adminOwner = videoActorFromAdmin(
    { typ: 'admin', adminId: 'a1', email: 'a@b.c', name: 'Ada', role: 'OWNER', iat: 0, exp: 0 } as never);
  const adminViewer = videoActorFromAdmin(
    { typ: 'admin', adminId: 'a2', email: 'v@b.c', name: 'Vic', role: 'VIEWER', iat: 0, exp: 0 } as never);

  const made: string[] = [];
  const mk = async (status: string, extra: Record<string, unknown> = {}) => {
    const top = await prisma.inductionVideo.findFirst({
      where: { jobSiteId: site.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const v = await prisma.inductionVideo.create({
      data: { jobSiteId: site.id, version: (top?.version ?? 0) + 1, status, ...extra },
      select: { id: true, version: true },
    });
    made.push(v.id);
    return v;
  };

  try {
    console.log('\nTHE PREDICATE THE UI ASKS');
    const base = { publishedAt: null, supersededAt: null, viewCount: 0 };
    for (const s of ['DRAFT', 'INFORMATION_REQUIRED', 'SCRIPT_READY', 'GENERATION_FAILED']) {
      chk(`${s} may be deleted`, svc.versionMayBeDeleted({ ...base, status: s }) === true);
    }
    for (const s of ['SCRIPT_APPROVED', 'NARRATION_READY', 'VIDEO_READY', 'PUBLISHED',
                     'SCRIPT_GENERATING', 'NARRATION_GENERATING', 'VIDEO_GENERATING']) {
      chk(`${s} may NOT be deleted`, svc.versionMayBeDeleted({ ...base, status: s }) === false);
    }
    chk('a watched version may not be deleted whatever its status',
      svc.versionMayBeDeleted({ ...base, status: 'SCRIPT_READY', viewCount: 1 }) === false,
      'one view and it is the record of somebody’s induction');
    chk('a superseded version may not be deleted',
      svc.versionMayBeDeleted({ ...base, status: 'SCRIPT_READY', supersededAt: new Date() }) === false);
    chk('a withdrawn-but-once-published version may not be deleted',
      svc.versionMayBeDeleted({ status: 'VIDEO_READY', publishedAt: new Date(),
                                supersededAt: null, viewCount: 0 }) === false,
      'withdrawal clears publishedAt, so the status is checked too');

    console.log('\nWHO MAY DELETE');
    const forRole = await mk('SCRIPT_READY');
    chk('a Project Manager may not', (await svc.deleteVideoVersion(pm, forRole.id)).ok === false);
    chk('an Admin VIEWER may not', (await svc.deleteVideoVersion(adminViewer, forRole.id)).ok === false);
    chk('  and it is still there', Boolean(await prisma.inductionVideo.findUnique({ where: { id: forRole.id } })));
    chk('an Admin OWNER may', (await svc.deleteVideoVersion(adminOwner, forRole.id)).ok === true);
    chk('  and it is gone', (await prisma.inductionVideo.findUnique({ where: { id: forRole.id } })) === null);

    console.log('\nWHAT IS REFUSED, AGAINST REAL ROWS');
    const approved = await mk('SCRIPT_APPROVED');
    const r1 = await svc.deleteVideoVersion(director, approved.id);
    chk('an approved version is refused', r1.ok === false, r1.error);
    chk('  and says to generate a new version instead', /supersedes it/.test(r1.error ?? ''));

    const published = await mk('PUBLISHED', { publishedAt: new Date() });
    const r2 = await svc.deleteVideoVersion(director, published.id);
    chk('a published version is refused', r2.ok === false);
    chk('  and says to withdraw instead', /[Ww]ithdraw/.test(r2.error ?? ''));

    /*
     * A DEFENSIVE STATE, pinned deliberately. In practice publishedAt is only set
     * while the status is PUBLISHED, and a withdrawal clears it - so the
     * `publishedAt ||` half of the guard protects a state the app does not
     * currently reach. It is kept because it is the cheaper half of the test and
     * the one that would matter if any future path set publishedAt without the
     * status, and it is asserted so nobody removes it as dead code.
     */
    const stampedButNotPublished = await mk('SCRIPT_READY', { publishedAt: new Date() });
    const rP = await svc.deleteVideoVersion(director, stampedButNotPublished.id);
    chk('a version stamped as published is refused whatever its status says',
      rP.ok === false, rP.error);

    const superseded = await mk('SCRIPT_READY', { supersededAt: new Date() });
    chk('a superseded version is refused',
      (await svc.deleteVideoVersion(director, superseded.id)).ok === false);

    const watched = await mk('SCRIPT_READY');
    const worker = await prisma.worker.findFirst({ select: { id: true, fullName: true } });
    if (worker) {
      await prisma.inductionVideoView.create({
        data: { videoId: watched.id, jobSiteId: site.id, workerId: worker.id,
                workerName: worker.fullName ?? 'W', furthestMs: 1000 },
      });
      const r3 = await svc.deleteVideoVersion(director, watched.id);
      chk('a WATCHED version is refused even though it is only SCRIPT_READY',
        r3.ok === false, r3.error);
      chk('  and says why', /operative has watched/.test(r3.error ?? ''));
    } else {
      chk('a watched version is refused', true, 'no worker to test with — predicate covered above');
    }

    const busy = await mk('SCRIPT_READY');
    await prisma.inductionVideoJob.create({
      data: { videoId: busy.id, kind: 'SCRIPT', status: 'QUEUED', requestedByName: 'test' },
    });
    const r4 = await svc.deleteVideoVersion(director, busy.id);
    chk('a version with a job in flight is refused', r4.ok === false, r4.error);
    chk('  because the row is that job’s lock', /still running/.test(r4.error ?? ''));

    console.log('\nA CLEAN DELETE TAKES ITS CHILDREN AND LEAVES THE SPEND');
    const doomed = await mk('SCRIPT_READY');
    await prisma.inductionVideoScene.create({
      data: { videoId: doomed.id, sceneType: 'WELCOME', order: 0, heading: 'Hi',
              narration: 'Hello there', visualTemplate: 'brand-standard',
              sourceRefs: [] as never, required: true },
    });
    await prisma.inductionVideoEvent.create({
      data: { videoId: doomed.id, action: 'SCRIPT_REQUESTED', actorName: 'test' },
    });
    await prisma.aiUsageEvent.create({
      data: { jobSiteId: site.id, videoId: doomed.id, purpose: 'script',
              provider: 'test', estimatedPence: 7 },
    });
    const r5 = await svc.deleteVideoVersion(director, doomed.id);
    chk('a clean draft deletes', r5.ok === true, r5.error ?? '');
    chk('  the row is gone',
      (await prisma.inductionVideo.findUnique({ where: { id: doomed.id } })) === null);
    chk('  its scenes went with it',
      (await prisma.inductionVideoScene.count({ where: { videoId: doomed.id } })) === 0);
    chk('  its events went with it',
      (await prisma.inductionVideoEvent.count({ where: { videoId: doomed.id } })) === 0);
    chk('  but the SPEND survives',
      (await prisma.aiUsageEvent.count({ where: { videoId: doomed.id } })) === 1,
      'deleting must not be a way to buy past the daily cap');
    await prisma.aiUsageEvent.deleteMany({ where: { videoId: doomed.id } });

    console.log('\nTHE VERSION NUMBER IS FREED, AS INTENDED');
    const top = await prisma.inductionVideo.findFirst({
      where: { jobSiteId: site.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const next = await mk('DRAFT');
    chk('the next version reuses the freed number',
      next.version === (top?.version ?? 0) + 1,
      'version numbers count scripts that exist — the same rule as a blocked attempt');

    console.log('\nTHROUGH THE SHARED DISPATCHER, SO BOTH TIERS AGREE');
    const viaDispatcher = await mk('SCRIPT_READY');
    const out = await handleVideoAction(director, viaDispatcher.id, { action: 'delete' });
    chk('the dispatcher deletes', out.status === 200 && out.payload.ok === true,
      JSON.stringify(out.payload));
    const refusedForPm = await mk('SCRIPT_READY');
    const out2 = await handleVideoAction(pm, refusedForPm.id, { action: 'delete' });
    chk('and refuses a Project Manager with a 400, not a crash',
      out2.status === 400 && out2.payload.ok === false);

    console.log('\nMEDIA BEFORE THE ROW, AND THE TWO ATTRIBUTION FIXES');
    const src = read('services/inductionVideo/inductionVideoService.ts');
    const mediaAt = src.indexOf('for (const path of media) await deleteMedia(path);');
    const rowAt = src.indexOf('await prisma.inductionVideo.delete(');
    chk('media is deleted before the row', mediaAt > 0 && rowAt > mediaAt,
      'a row deleted first would orphan files with nothing pointing at them');
    chk('every media path is collected, including each scene’s audio',
      /video\.scenes\.map\(\(s\) => s\.audioBlobPath\)/.test(src) &&
      /video\.captionsBlobPath,/.test(src) &&
      /video\.videoBlobPath,/.test(src));
    chk('withdrawing an approval now clears the realm too',
      /approvedByAdminId: null,\s*\n\s*approvedByRealm: null,/.test(src),
      'a withdrawn approval must not keep "approved from the Admin Centre"');
    chk('and deletes the captions and transcript rather than unlinking them',
      /for \(const path of \[priorCaptions, priorTranscript\]\)/.test(src),
      'clearing the paths alone left paid-for files in the container');

    console.log('\nONE PREDICATE, ASKED EVERYWHERE IT IS OFFERED');
    for (const [label, f] of [
      ['the shared version surface', 'components/inductionVideo/VideoVersionSurface.tsx'],
      ['the Platform project list', 'app/platform/dashboard/sites/[id]/induction-video/page.tsx'],
      ['the Admin project list', 'app/admin/(dashboard)/induction-videos/projects/[id]/page.tsx'],
    ] as const) {
      chk(`${label} mounts the button`, /<DeleteVersionButton\b/.test(read(f)));
      chk(`  and asks the shared predicate`, /versionMayBeDeleted\(/.test(read(f)));
    }
    chk('the button itself decides nothing',
      !/versionMayBeDeleted|SCRIPT_READY|publishedAt/.test(
        read('components/inductionVideo/DeleteVersionButton.tsx')),
      'a hidden control is not a guard; the service refuses');
    chk('it asks before destroying',
      /Yes, delete it/.test(read('components/inductionVideo/DeleteVersionButton.tsx')));
  } finally {
    for (const id of made) {
      await prisma.inductionVideo.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
