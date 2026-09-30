export {};
/**
 * BUILD-PHASE RESET: WHAT IT RELAXES, AND WHAT IT MUST NEVER RELAX.
 *
 * ── WHAT THIS SUITE IS REALLY FOR ─────────────────────────────────────────
 *
 * Anybody can add a delete button. The valuable part is proving the line holds:
 * that the flag stands down version discipline (superseded, approved, issued) and
 * does NOT stand down evidence (published to operatives, watched by one). So every
 * evidence refusal below is asserted TWICE — once with the flag off and once with
 * it on — because a test that only ever runs in strict mode would pass just as
 * happily if the flag disabled every guard in the file.
 *
 * ── AND THE CASCADE, WHICH IS THE REAL HAZARD ─────────────────────────────
 *
 * `InductionVideo.libraryAssetId` is `onDelete: Cascade` and `InductionVideoView`
 * cascades from the video, so `prisma.libraryAsset.delete()` on an asset with
 * published productions destroys operative viewing records and reports success.
 * No foreign key refuses it. `assetDeletion` is the only thing that does, which is
 * why this suite deletes a library asset with a WATCHED production and then counts
 * the view rows to prove they are still there.
 *
 * Run: npx tsx scripts/content_reset_verify.ts
 */
const { prisma } = require('../lib/prisma');
const consumption = require('../services/inductionContent/consumption');
const buildPhase = require('../services/inductionContent/buildPhase');
const modSvc = require('../services/inductionModules/inductionModuleService');
const cat = require('../services/inductionModules/moduleCatalogue');
const libSvc = require('../services/inductionVideo/libraryAssetService');
const vidSvc = require('../services/inductionVideo/inductionVideoService');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { videoActorFromPlatformViewer } = require('../services/inductionVideo/videoActor');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The flag is a function of the environment, so each mode is set explicitly. */
const strict = () => {
  delete process.env.INDUCTION_CONTENT_RESET_ENABLED;
};
const buildMode = () => {
  process.env.INDUCTION_CONTENT_RESET_ENABLED = '1';
};

const director = moduleActorFromPlatformViewer(
  { id: 'crv-d', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);
const manager = moduleActorFromPlatformViewer(
  { id: 'crv-m', name: 'Sam Manager', role: 'SITE_MANAGER', siteIds: [] } as never);

const madeModules: string[] = [];
const madeAssets: string[] = [];
const madeVideos: string[] = [];

(async () => {
  const site = await prisma.jobSite.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  if (!site) { console.log('  no active site to test against'); process.exit(1); }
  /*
   * A WORKER IS CREATED, NOT LOOKED FOR. The cascade trap below is the single most
   * important assertion in this file — it is the one proving a delete cannot take
   * somebody's viewing record with it — and on a database with no workers a
   * `findFirst` silently skipped it, reporting PASS for a test that never ran.
   * A fixture of our own, removed in the finally, cannot be skipped.
   */
  const worker = await prisma.worker.create({
    data: {
      fullName: 'CRV Test Operative',
      company: 'CRV Test',
      mobile: `+4479${Date.now().toString().slice(-8)}`,
    },
    select: { id: true, fullName: true },
  });

  const vidDirector = videoActorFromPlatformViewer(
    { id: 'crv-vd', name: 'Dee Director', role: 'DIRECTOR', siteIds: [site.id] } as never);

  /** A module with `revisions` worth of wording, the last one issued if asked. */
  const mkModule = async (slug: string, opts: { issued?: boolean } = {}) => {
    const m = await prisma.inductionModule.create({
      data: {
        slug: `CRV_${slug}_${Date.now()}`,
        title: `Test ${slug}`,
        order: 900,
        active: true,
        revisions: {
          create: {
            version: 1,
            status: opts.issued ? 'ISSUED' : 'DRAFT',
            heading: 'Heading',
            narration: 'x'.repeat(80),
            contentHash: 'h',
            preparedByName: 'Test',
            ...(opts.issued ? { issuedAt: new Date(), issuedByName: 'Test' } : {}),
          },
        },
      },
      select: { id: true, revisions: { select: { id: true } } },
    });
    madeModules.push(m.id);
    return m;
  };

  const mkAsset = async (slug: string, opts: { issued?: boolean } = {}) => {
    const a = await prisma.libraryAsset.create({
      data: {
        slug: `crv-${slug}-${Date.now()}`,
        title: `Test asset ${slug}`,
        order: 900,
        active: true,
        revisions: {
          create: {
            version: 1,
            status: opts.issued ? 'ISSUED' : 'DRAFT',
            preparedByName: 'Test',
            ...(opts.issued ? { issuedAt: new Date(), issuedByName: 'Test' } : {}),
          },
        },
      },
      select: { id: true, revisions: { select: { id: true } } },
    });
    madeAssets.push(a.id);
    return a;
  };

  /** A company production of an asset, optionally published and/or watched. */
  const mkProduction = async (
    assetId: string,
    opts: { published?: boolean; watched?: boolean; status?: string } = {},
  ) => {
    const top = await prisma.inductionVideo.findFirst({
      where: { libraryAssetId: assetId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const v = await prisma.inductionVideo.create({
      data: {
        scope: 'COMPANY',
        libraryAssetId: assetId,
        version: (top?.version ?? 0) + 1,
        status: opts.status ?? (opts.published ? 'PUBLISHED' : 'SCRIPT_READY'),
        ...(opts.published ? { publishedAt: new Date() } : {}),
      },
      select: { id: true, version: true },
    });
    madeVideos.push(v.id);
    if (opts.watched && worker) {
      await prisma.inductionVideoView.create({
        data: {
          videoId: v.id, jobSiteId: site.id, workerId: worker.id,
          workerName: worker.fullName ?? 'W', furthestMs: 1000,
        },
      });
    }
    return v;
  };

  try {
    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nTHE FLAG IS FAIL-CLOSED');
    strict();
    chk('unset means off', buildPhase.contentResetEnabled() === false);
    for (const v of ['', '0', 'true', 'yes', 'TRUE', '1 ', 'on']) {
      process.env.INDUCTION_CONTENT_RESET_ENABLED = v;
      chk(`  ${JSON.stringify(v)} means off`, buildPhase.contentResetEnabled() === false);
    }
    buildMode();
    chk('only exactly "1" turns it on', buildPhase.contentResetEnabled() === true);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nCONSUMPTION IS THE ONE DEFINITION');
    strict();
    const cleanAsset = await mkAsset('clean');
    const cleanProd = await mkProduction(cleanAsset.id);
    let c = await consumption.videoConsumption(cleanProd.id);
    chk('a draft production is not consumed', c.consumed === false);

    const pubAsset = await mkAsset('published');
    const pubProd = await mkProduction(pubAsset.id, { published: true });
    c = await consumption.videoConsumption(pubProd.id);
    chk('a published production IS consumed', c.consumed === true);
    chk('  and says so in a sentence a manager can read',
      /published to operatives/.test(c.reason ?? ''), c.reason ?? '');

    // A withdrawal clears publishedAt but not the status, and vice versa; either
    // fact alone is enough, which is why both are checked.
    const withdrawn = await mkProduction(pubAsset.id, { status: 'VIDEO_READY' });
    await prisma.inductionVideo.update({
      where: { id: withdrawn.id }, data: { publishedAt: new Date() },
    });
    c = await consumption.videoConsumption(withdrawn.id);
    chk('a withdrawn-but-once-published production is still consumed', c.consumed === true);

    if (worker) {
      const watchAsset = await mkAsset('watched');
      const watchProd = await mkProduction(watchAsset.id, { watched: true });
      c = await consumption.videoConsumption(watchProd.id);
      chk('a WATCHED but unpublished production is consumed', c.consumed === true);
      chk('  and names the operative fact, not the weaker published one',
        /operative has watched/.test(c.reason ?? ''), c.reason ?? '');
      chk('  and the asset inherits it', (await consumption.assetConsumption(watchAsset.id)).consumed === true);
    } else {
      chk('watched consumption', true, 'no worker in this database — published path covered');
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nA MODULE: NEVER ISSUED IS A FALSE START, NOT HISTORY');
    strict();
    const draftModule = await mkModule('draftonly');
    let d = await modSvc.moduleDeletion(draftModule.id);
    chk('a never-issued module is deletable even in strict mode', d.deletable === true,
      d.blockedReason ?? '');
    chk('a Site Manager may not delete it',
      (await modSvc.deleteModule(manager, draftModule.id)).ok === false);
    chk('  and it is still there',
      Boolean(await prisma.inductionModule.findUnique({ where: { id: draftModule.id } })));
    const delOk = await modSvc.deleteModule(director, draftModule.id);
    chk('a Director may', delOk.ok === true, delOk.error ?? '');
    chk('  and the row is gone',
      (await prisma.inductionModule.findUnique({ where: { id: draftModule.id } })) === null);
    chk('  and its revisions went with it (cascade)',
      (await prisma.inductionModuleRevision.count({ where: { moduleId: draftModule.id } })) === 0);

    console.log('\nA MODULE: ISSUED WORDING IS VERSION DISCIPLINE, SO THE FLAG MOVES IT');
    const issuedModule = await mkModule('issued', { issued: true });
    strict();
    d = await modSvc.moduleDeletion(issuedModule.id);
    chk('issued-but-unconsumed is REFUSED in strict mode', d.deletable === false);
    chk('  and points at retire instead', /[Rr]etire it instead/.test(d.blockedReason ?? ''),
      d.blockedReason ?? '');
    buildMode();
    d = await modSvc.moduleDeletion(issuedModule.id);
    chk('and ALLOWED in build mode', d.deletable === true, d.blockedReason ?? '');

    console.log('\nA MODULE: PER-PROJECT DECISIONS GO WITH IT');
    const decided = await mkModule('decided');
    await prisma.siteInductionModule.create({
      data: {
        jobSiteId: site.id, moduleId: decided.id, state: 'EXCLUDED',
        reason: 'not relevant here', decidedByName: 'Test',
      },
    });
    d = await modSvc.moduleDeletion(decided.id);
    chk('the decision is counted before the press', d.siteDecisions === 1);
    const delDecided = await modSvc.deleteModule(director, decided.id);
    chk('deleting reports how many decisions went',
      delDecided.ok === true && delDecided.value.siteDecisions === 1,
      delDecided.ok ? '' : delDecided.error);
    chk('  and the decision row is gone',
      (await prisma.siteInductionModule.count({ where: { moduleId: decided.id } })) === 0);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nDISCARDING ONE DRAFT IS THE ROUTINE UNDO, NOT A SMALL RESET');
    strict(); // no flag: a draft has reached nobody, so none is needed
    const draftMod = await mkModule('draftundo', { issued: true });
    // An issued revision in force, a draft on top of it, and a published video
    // carrying the ISSUED wording — the exact state the owner described.
    const liveRev = draftMod.revisions[0].id;
    const newDraft = await prisma.inductionModuleRevision.create({
      data: {
        moduleId: draftMod.id, version: 2, status: 'DRAFT', heading: 'Reworded',
        narration: 'y'.repeat(80), contentHash: 'h2', preparedByName: 'Test',
      },
      select: { id: true },
    });
    const dmAsset = await mkAsset('draftundoasset');
    const dmVideo = await mkProduction(dmAsset.id, { published: true });
    await prisma.inductionVideoScene.create({
      data: {
        videoId: dmVideo.id, sceneType: 'COMPANY_MODULE', order: 1,
        heading: 'Live wording', narration: 'x'.repeat(50), moduleRevisionId: liveRev,
      },
    });

    chk('a PROJECT MANAGER may not discard a draft',
      (await modSvc.discardModuleDraft(
        moduleActorFromPlatformViewer(
          { id: 'crv-pm', name: 'Pat PM', role: 'PROJECT_MANAGER', siteIds: [] } as never),
        draftMod.id, newDraft.id)).ok === false);
    chk('a SITE MANAGER may — the same authority that wrote it',
      (await modSvc.discardModuleDraft(manager, draftMod.id, newDraft.id)).ok === true,
      'saveDraft has no author check, so refusing this would protect nothing');
    chk('  the draft is gone',
      (await prisma.inductionModuleRevision.findUnique({ where: { id: newDraft.id } })) === null);
    chk('  THE ISSUED REVISION IS UNTOUCHED AND STILL IN FORCE', Boolean(
      await prisma.inductionModuleRevision.findFirst({
        where: { id: liveRev, status: 'ISSUED' } })),
      'the whole promise of a per-draft discard');
    chk('  THE PUBLISHED VIDEO IS UNTOUCHED', Boolean(
      await prisma.inductionVideo.findUnique({ where: { id: dmVideo.id } })));
    chk('  and its scene still carries the wording an operative heard',
      (await prisma.inductionVideoScene.count({
        where: { videoId: dmVideo.id, moduleRevisionId: liveRev } })) === 1);
    chk('  and the module still resolves as LIVE',
      (await prisma.inductionModuleRevision.count({
        where: { moduleId: draftMod.id } })) === 1);

    console.log('\nWHAT A DRAFT DISCARD REFUSES');
    const issuedOnly = await mkModule('issuedonly', { issued: true });
    const refuseIssued = await modSvc.discardModuleDraft(
      director, issuedOnly.id, issuedOnly.revisions[0].id);
    chk('an ISSUED revision cannot be discarded this way', refuseIssued.ok === false,
      refuseIssued.error);
    chk('  and it points at starting a new draft instead',
      /start a\s+new draft/i.test(refuseIssued.error ?? ''));
    const otherMod = await mkModule('othermod');
    const crossedModule = await modSvc.discardModuleDraft(
      director, otherMod.id, issuedOnly.revisions[0].id);
    chk('a revision of another module is refused', crossedModule.ok === false,
      crossedModule.error);
    chk('  and it is still there', Boolean(
      await prisma.inductionModuleRevision.findUnique({
        where: { id: issuedOnly.revisions[0].id } })));

    // The defensive path: a draft should be unreachable, so if one IS carried the
    // service refuses rather than deleting the thing that proves the bug.
    const oddMod = await mkModule('oddmod');
    const oddAsset = await mkAsset('oddasset');
    const oddVideo = await mkProduction(oddAsset.id, { status: 'SCRIPT_READY' });
    await prisma.inductionVideoScene.create({
      data: {
        videoId: oddVideo.id, sceneType: 'COMPANY_MODULE', order: 1,
        heading: 'Should not happen', narration: 'x'.repeat(50),
        moduleRevisionId: oddMod.revisions[0].id,
      },
    });
    const odd = await modSvc.discardModuleDraft(director, oddMod.id, oddMod.revisions[0].id);
    chk('a draft that somehow reached a video is REFUSED, not deleted',
      odd.ok === false, odd.error);
    chk('  and says to report it', /[Rr]eport this/.test(odd.error ?? ''));

    console.log('\nDISCARDING THE ONLY DRAFT LEAVES THE MODULE BLANK, AND SAYS SO');
    const soleDraft = await mkModule('soledraft');
    const sole = await modSvc.discardModuleDraft(
      director, soleDraft.id, soleDraft.revisions[0].id);
    chk('it is allowed', sole.ok === true, sole.ok ? '' : sole.error);
    chk('  and reports that nothing is written now',
      sole.ok === true && sole.value.leftNothingWritten === true,
      'the page turns this into a sentence before the press');
    chk('  THE MODULE ITSELF SURVIVED', Boolean(
      await prisma.inductionModule.findUnique({ where: { id: soleDraft.id } })),
      'discarding a draft is never a way to lose the subject');
    // Version numbers are reused, so the history has no gap.
    const reopened = await modSvc.startDraft(director, soleDraft.id);
    chk('  and the next draft reuses version 1 rather than skipping to 2',
      reopened.ok === true && reopened.value.version === 1,
      reopened.ok ? '' : reopened.error);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTART AGAIN KEEPS THE SUBJECT — THE DISTINCTION THAT MATTERS');
    buildMode();
    const resetMod = await mkModule('resetme', { issued: true });
    // A project decision and a production, both of which the reset must treat
    // differently: the decision survives, the production goes.
    await prisma.siteInductionModule.create({
      data: {
        jobSiteId: site.id, moduleId: resetMod.id, state: 'EXCLUDED',
        reason: 'covered by our own briefing', decidedByName: 'Test',
      },
    });
    const rmAsset = await mkAsset('resetmeasset');
    const rmProd = await mkProduction(rmAsset.id, { status: 'SCRIPT_READY' });
    await prisma.inductionVideo.update({
      where: { id: rmProd.id },
      data: { sourceModuleRevisionId: resetMod.revisions[0].id },
    });
    let mr = await modSvc.moduleReset(resetMod.id);
    chk('the reset counts the revisions and the production', mr.resettable === true &&
      mr.revisions === 1 && mr.productions === 1, mr.blockedReason ?? '');
    chk('  and reports the decision it will KEEP', mr.siteDecisionsKept === 1);
    chk('a Site Manager may not start a module again',
      (await modSvc.resetModule(manager, resetMod.id)).ok === false);
    const didReset = await modSvc.resetModule(director, resetMod.id);
    chk('a Director may', didReset.ok === true, didReset.ok ? '' : didReset.error);
    chk('  THE MODULE ITSELF SURVIVED', Boolean(
      await prisma.inductionModule.findUnique({ where: { id: resetMod.id } })),
      'this is the whole point: the subject is permanent, the wording is not');
    chk('  its revisions went',
      (await prisma.inductionModuleRevision.count({ where: { moduleId: resetMod.id } })) === 0);
    chk('  the production generated from it went',
      (await prisma.inductionVideo.findUnique({ where: { id: rmProd.id } })) === null);
    chk('  AND THE PROJECT DECISION SURVIVED',
      (await prisma.siteInductionModule.count({ where: { moduleId: resetMod.id } })) === 1,
      'delete took these; reset must not, or a reason somebody recorded is lost');
    const afterSettings = await prisma.inductionModule.findUnique({
      where: { id: resetMod.id },
      select: { slug: true, category: true, order: true, mandatory: true, defaultIncluded: true },
    });
    chk('  and so did its settings and running order',
      afterSettings.order === 900 && afterSettings.slug.startsWith('CRV_resetme'));

    console.log('\nA CONSUMED MODULE CANNOT BE RESET EITHER');
    const seenMod = await mkModule('seenmod', { issued: true });
    const seenAsset = await mkAsset('seenassetr');
    const seenProd = await mkProduction(seenAsset.id, { published: true });
    await prisma.inductionVideoScene.create({
      data: {
        videoId: seenProd.id, sceneType: 'COMPANY_MODULE', order: 1,
        heading: 'Seen', narration: 'x'.repeat(50),
        moduleRevisionId: seenMod.revisions[0].id,
      },
    });
    for (const [label, set] of [['strict', strict], ['BUILD', buildMode]] as const) {
      set();
      const r = await modSvc.moduleReset(seenMod.id);
      chk(`reset is refused on a published module (${label} mode)`, r.resettable === false,
        r.blockedReason ?? '');
      chk(`  and the service refuses it (${label} mode)`,
        (await modSvc.resetModule(director, seenMod.id)).ok === false);
    }
    chk('  its revisions are still there',
      (await prisma.inductionModuleRevision.count({ where: { moduleId: seenMod.id } })) === 1,
      'reset is not a way round the evidence line');

    console.log('\nA JOB IN FLIGHT BLOCKS THE RESET, WHATEVER THE FLAG SAYS');
    const busyMod = await mkModule('busymod');
    const bmAsset = await mkAsset('busymodasset');
    const bmProd = await mkProduction(bmAsset.id, { status: 'SCRIPT_READY' });
    await prisma.inductionVideo.update({
      where: { id: bmProd.id },
      data: { sourceModuleRevisionId: busyMod.revisions[0].id },
    });
    await prisma.inductionVideoJob.create({
      data: { videoId: bmProd.id, kind: 'RENDER', status: 'RUNNING', requestedByName: 'test' },
    });
    buildMode();
    const bmReset = await modSvc.moduleReset(busyMod.id);
    chk('refused while something is being generated from it', bmReset.resettable === false,
      bmReset.blockedReason ?? '');
    chk('  because the row is that job’s lock',
      /still being generated/.test(bmReset.blockedReason ?? ''));

    console.log('\nA STANDARD SUBJECT IS NOT DELETED TO RESTART IT');
    /*
     * THE REAL ROW, NOT A FIXTURE. The standard slugs are unique and already exist
     * in any database with a seeded catalogue, so creating one fails - and a
     * fixture would prove the rule against a slug nobody uses rather than against
     * Company Introduction itself. `moduleDeletion` and `moduleReset` are reads, so
     * the only mutation here is the retire/restore pair, which is put back in a
     * finally of its own.
     */
    const standardSlug = cat.MODULE_CATALOGUE[0].slug;
    const standard = await prisma.inductionModule.findUnique({
      where: { slug: standardSlug },
      select: { id: true, active: true },
    });
    if (!standard) {
      chk('standard subject guard', false,
        `${standardSlug} is not in this database - seed the catalogue and re-run`);
    } else {
      buildMode();
      // It must be ACTIVE for the guard to apply; put whatever it was back after.
      await prisma.inductionModule.update({
        where: { id: standard.id }, data: { active: true },
      });
      try {
        const sd = await modSvc.moduleDeletion(standard.id);
        chk(`an ACTIVE standard subject (${standardSlug}) cannot be deleted`,
          sd.deletable === false, sd.blockedReason ?? '');
        chk('  and the refusal names start-again and retire instead',
          /Start again/.test(sd.blockedReason ?? '') &&
          /retire it/.test(sd.blockedReason ?? ''));
        /*
         * ⚠ NO `deleteModule` CALL AGAINST THIS ROW, DELIBERATELY. It is the real
         * seeded Company Introduction, and mutation-testing this guard means
         * DISABLING it and re-running — at which point a destructive call here
         * succeeds and takes the row with it. That is not hypothetical: it deleted
         * the local row on 2026-09-30 and the catalogue had to be re-seeded.
         *
         * The predicate above IS the guard — `deleteModule` does nothing but ask
         * `moduleDeletion` and return its reason — and the deploy gate asserts that
         * delegation in the source, so refusing to call it here costs no coverage.
         */

        /*
         * RETIRING IS THE ESCAPE HATCH, not a dead end: one press and the subject
         * becomes deletable, because by then somebody has decided the company has
         * stopped briefing on it rather than merely wanting a clean slate. Asserted
         * so the protection cannot quietly become absolute.
         */
        await prisma.inductionModule.update({
          where: { id: standard.id }, data: { active: false },
        });
        const retired = await modSvc.moduleDeletion(standard.id);
        chk('  once RETIRED the standard-subject guard lifts',
          retired.blockedReason === null ||
          !/standard company subject/.test(retired.blockedReason ?? ''),
          retired.blockedReason ?? 'deletable');
      } finally {
        await prisma.inductionModule.update({
          where: { id: standard.id }, data: { active: standard.active },
        });
      }
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nA MODULE THAT AN INDUCTION CARRIED: REFUSED IN BOTH MODES');
    const carriedModule = await mkModule('carried', { issued: true });
    const carrierAsset = await mkAsset('carrier');
    const carrier = await mkProduction(carrierAsset.id, { published: true });
    await prisma.inductionVideoScene.create({
      data: {
        videoId: carrier.id, sceneType: 'COMPANY_MODULE', order: 1,
        heading: 'Carried', narration: 'x'.repeat(50),
        moduleRevisionId: carriedModule.revisions[0].id,
      },
    });
    for (const [label, set] of [['strict', strict], ['BUILD', buildMode]] as const) {
      set();
      const dd = await modSvc.moduleDeletion(carriedModule.id);
      chk(`a module in a PUBLISHED induction is refused (${label} mode)`, dd.deletable === false,
        dd.blockedReason ?? '');
      const attempt = await modSvc.deleteModule(director, carriedModule.id);
      chk(`  and the service refuses it too (${label} mode)`, attempt.ok === false);
      chk(`  and it is still there (${label} mode)`,
        Boolean(await prisma.inductionModule.findUnique({ where: { id: carriedModule.id } })));
    }

    // The other carrier: a company production made FROM the module, which is reached
    // by sourceModuleRevisionId rather than by a scene. Missing it would call the
    // module unconsumed.
    const producedFrom = await mkModule('producedfrom', { issued: true });
    const pfAsset = await mkAsset('pf');
    const pfProd = await mkProduction(pfAsset.id, { published: true });
    await prisma.inductionVideo.update({
      where: { id: pfProd.id },
      data: { sourceModuleRevisionId: producedFrom.revisions[0].id },
    });
    buildMode();
    chk('a module a PUBLISHED company video was produced from is refused',
      (await modSvc.moduleDeletion(producedFrom.id)).deletable === false,
      'reached by sourceModuleRevisionId, not by a scene');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nA GENERATED LIBRARY VIDEO BLOCKS ITS MODULE’S DELETE');
    const genModule = await mkModule('genmod');
    const genAsset = await prisma.libraryAsset.create({
      data: {
        slug: `crv-gen-${Date.now()}`, title: 'Generated from it', order: 901,
        provenance: 'GENERATED', moduleId: genModule.id,
      },
      select: { id: true },
    });
    madeAssets.push(genAsset.id);
    buildMode();
    d = await modSvc.moduleDeletion(genModule.id);
    chk('refused while a GENERATED asset is produced from it', d.deletable === false);
    chk('  and names the asset so the fix is obvious',
      /Generated from it/.test(d.blockedReason ?? ''), d.blockedReason ?? '');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nTHE CASCADE TRAP: A LIBRARY ASSET WITH A WATCHED PRODUCTION');
    if (worker) {
      const trapAsset = await mkAsset('trap');
      const trapProd = await mkProduction(trapAsset.id, { published: true, watched: true });
      const viewsBefore = await prisma.inductionVideoView.count({
        where: { videoId: trapProd.id },
      });
      chk('the production has a viewing record to protect', viewsBefore === 1);
      for (const [label, set] of [['strict', strict], ['BUILD', buildMode]] as const) {
        set();
        const ad = await libSvc.assetDeletion(trapAsset.id);
        chk(`the asset is refused (${label} mode)`, ad.deletable === false, ad.blockedReason ?? '');
        chk(`  and it reports the evidence fact separately (${label} mode)`, ad.consumed === true);
        const attempt = await libSvc.deleteLibraryAsset(director, trapAsset.id);
        chk(`  the service refuses it (${label} mode)`, attempt.ok === false);
        const reset = await libSvc.resetLibraryAsset(director, trapAsset.id);
        chk(`  and "start again" cannot be used to get round it (${label} mode)`,
          reset.ok === false, reset.ok ? 'IT WENT THROUGH' : reset.error);
      }
      chk('THE VIEW ROW SURVIVED every attempt',
        (await prisma.inductionVideoView.count({ where: { videoId: trapProd.id } })) === 1,
        'the FK cascade would have taken it silently');
      chk('  and so did the production',
        Boolean(await prisma.inductionVideo.findUnique({ where: { id: trapProd.id } })));
    } else {
      chk('cascade trap', true, 'no worker in this database — cannot build a view row');
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nSTART AGAIN KEEPS THE WIRING');
    const resetAsset = await mkAsset('reset');
    /*
     * THE WIRING, SET EXPLICITLY so its survival is a measurement rather than a
     * default. These are the fields the owner named: placement, category and the
     * module linkage. A reset that quietly dropped any of them would be
     * delete-and-recreate wearing a different label.
     */
    const resetModuleLink = await mkModule('assetlink');
    await prisma.libraryAsset.update({
      where: { id: resetAsset.id },
      data: {
        placement: 'CLOSING',
        category: 'PPE',
        moduleId: resetModuleLink.id,
        mandatory: true,
        defaultIncluded: true,
        order: 42,
        description: 'Kept through a reset.',
      },
    });
    await prisma.siteLibraryAsset.create({
      data: { jobSiteId: site.id, assetId: resetAsset.id, included: true, decidedByName: 'Test' },
    });
    await mkProduction(resetAsset.id);
    buildMode();
    const rr = await libSvc.resetLibraryAsset(director, resetAsset.id);
    chk('start again succeeds on unconsumed content', rr.ok === true, rr.ok ? '' : rr.error);
    chk('  its revisions went', (await prisma.libraryAssetRevision.count({
      where: { assetId: resetAsset.id } })) === 0);
    chk('  its productions went', (await prisma.inductionVideo.count({
      where: { libraryAssetId: resetAsset.id } })) === 0);
    const kept = await prisma.libraryAsset.findUnique({
      where: { id: resetAsset.id },
      select: {
        id: true, slug: true, title: true, description: true, placement: true,
        category: true, moduleId: true, mandatory: true, defaultIncluded: true,
        order: true, active: true,
      },
    });
    chk('  THE ASSET ITSELF STAYED', Boolean(kept));
    chk('  its PLACEMENT survived', kept?.placement === 'CLOSING', String(kept?.placement));
    chk('  its CATEGORY survived', kept?.category === 'PPE', String(kept?.category));
    chk('  ITS MODULE LINKAGE survived', kept?.moduleId === resetModuleLink.id,
      'a generated asset with no module cannot be produced at all');
    chk('  its inclusion rules survived',
      kept?.mandatory === true && kept?.defaultIncluded === true);
    chk('  its running order survived', kept?.order === 42);
    chk('  its title and description survived',
      kept?.title?.length > 0 && kept?.description === 'Kept through a reset.');
    chk('  and so did the project’s decision about it',
      (await prisma.siteLibraryAsset.count({ where: { assetId: resetAsset.id } })) === 1,
      'the whole reason this is not delete-and-recreate');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nA MANDATORY VIDEO CAN BE STARTED AGAIN BUT NOT DELETED');
    /*
     * THE BUG THIS PINS: the mandatory guard was added to the shared predicate, so
     * the refusal said "Start again to clear its revisions" and Start again then
     * refused for the same reason. Caught in one run; it must not come back.
     */
    const mand = await mkAsset('mandatory');
    await prisma.libraryAsset.update({
      where: { id: mand.id }, data: { mandatory: true, active: true },
    });
    buildMode();
    const mandDel = await libSvc.assetDeletion(mand.id);
    chk('an ACTIVE MANDATORY video cannot be deleted', mandDel.deletable === false,
      mandDel.blockedReason ?? '');
    chk('  and the refusal recommends starting again',
      /Start again to clear/.test(mandDel.blockedReason ?? ''));
    const mandReset = await libSvc.assetReset(mand.id);
    chk('  AND STARTING AGAIN IS ACTUALLY ALLOWED', mandReset.resettable === true,
      mandReset.blockedReason ?? 'the refusal above must not block what it recommends');
    const didMandReset = await libSvc.resetLibraryAsset(director, mand.id);
    chk('  the service agrees', didMandReset.ok === true,
      didMandReset.ok ? '' : didMandReset.error);
    chk('  and the video is still required on every project',
      (await prisma.libraryAsset.findUnique({
        where: { id: mand.id }, select: { mandatory: true, active: true },
      }))?.mandatory === true);
    // Making it optional is the escape hatch, as it is for retiring.
    await prisma.libraryAsset.update({ where: { id: mand.id }, data: { mandatory: false } });
    chk('  once OPTIONAL it becomes deletable',
      (await libSvc.assetDeletion(mand.id)).deletable === true,
      'protection without a dead end');

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nDISCARDING ONE REVISION');
    const revAsset = await mkAsset('rev');
    strict();
    const wrongAsset = await mkAsset('wrong');
    const crossed = await libSvc.discardLibraryRevision(
      director, wrongAsset.id, revAsset.revisions[0].id);
    chk('a revision of another asset is refused', crossed.ok === false, crossed.error);
    chk('  and it is still there', Boolean(await prisma.libraryAssetRevision.findUnique({
      where: { id: revAsset.revisions[0].id } })));
    const draftGone = await libSvc.discardLibraryRevision(
      director, revAsset.id, revAsset.revisions[0].id);
    chk('a DRAFT revision discards even in strict mode', draftGone.ok === true,
      draftGone.ok ? '' : draftGone.error);

    const issuedRev = await mkAsset('issuedrev', { issued: true });
    strict();
    const refusedRev = await libSvc.discardLibraryRevision(
      director, issuedRev.id, issuedRev.revisions[0].id);
    chk('an ISSUED revision is refused in strict mode', refusedRev.ok === false, refusedRev.error);
    buildMode();
    const allowedRev = await libSvc.discardLibraryRevision(
      director, issuedRev.id, issuedRev.revisions[0].id);
    chk('and discards in build mode when nobody has seen it', allowedRev.ok === true,
      allowedRev.ok ? '' : allowedRev.error);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nA VERSION: THE TWO HOUSEKEEPING REFUSALS MOVE, THE OTHERS DO NOT');
    const vAsset = await mkAsset('versions');
    const supd = await mkProduction(vAsset.id, { status: 'SCRIPT_READY' });
    await prisma.inductionVideo.update({
      where: { id: supd.id }, data: { supersededAt: new Date() },
    });
    strict();
    chk('superseded is refused in strict mode',
      (await vidSvc.deleteVideoVersion(vidDirector, supd.id)).ok === false);
    chk('  and the UI predicate agrees',
      vidSvc.versionMayBeDeleted({ status: 'SCRIPT_READY', publishedAt: null,
        supersededAt: new Date(), viewCount: 0 }) === false);
    buildMode();
    chk('  the UI predicate follows the flag',
      vidSvc.versionMayBeDeleted({ status: 'SCRIPT_READY', publishedAt: null,
        supersededAt: new Date(), viewCount: 0 }) === true,
      'a button that is offered and then refused is worse than no button');
    const supdGone = await vidSvc.deleteVideoVersion(vidDirector, supd.id);
    chk('superseded deletes in build mode', supdGone.ok === true, supdGone.ok ? '' : supdGone.error);

    const appr = await mkProduction(vAsset.id, { status: 'SCRIPT_APPROVED' });
    strict();
    chk('approved is refused in strict mode',
      (await vidSvc.deleteVideoVersion(vidDirector, appr.id)).ok === false);
    buildMode();
    chk('approved deletes in build mode',
      (await vidSvc.deleteVideoVersion(vidDirector, appr.id)).ok === true);

    const pub2 = await mkProduction(vAsset.id, { published: true });
    buildMode();
    const pubRefused = await vidSvc.deleteVideoVersion(vidDirector, pub2.id);
    chk('PUBLISHED is refused even in build mode', pubRefused.ok === false, pubRefused.error);
    chk('  and the UI predicate refuses it in build mode too',
      vidSvc.versionMayBeDeleted({ status: 'PUBLISHED', publishedAt: new Date(),
        supersededAt: null, viewCount: 0 }) === false);
    chk('  a watched version likewise, whatever its status',
      vidSvc.versionMayBeDeleted({ status: 'SCRIPT_READY', publishedAt: null,
        supersededAt: null, viewCount: 1 }) === false);

    const busy = await mkProduction(vAsset.id, { status: 'SCRIPT_READY' });
    await prisma.inductionVideoJob.create({
      data: { videoId: busy.id, kind: 'RENDER', status: 'RUNNING', requestedByName: 'test' },
    });
    buildMode();
    const busyRefused = await vidSvc.deleteVideoVersion(vidDirector, busy.id);
    chk('a job in flight is refused even in build mode', busyRefused.ok === false,
      busyRefused.error);
    chk('  because the row is that job’s lock, which no policy changes',
      /still running/.test(busyRefused.error ?? ''));

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nTHE SHARED BLOB IS NOT DELETED OUT FROM UNDER THE LIBRARY');
    const sharedAsset = await mkAsset('shared');
    const sharedProd = await mkProduction(sharedAsset.id, { status: 'SCRIPT_READY' });
    const sharedPath = `induction-video/${sharedAsset.id}/${sharedProd.id}/video-x.mp4`;
    await prisma.inductionVideo.update({
      where: { id: sharedProd.id }, data: { videoBlobPath: sharedPath },
    });
    chk('a rendered file nothing points at is ours to delete',
      (await consumption.blobServedByLibrary(sharedPath)) === false);
    await prisma.libraryAssetRevision.update({
      where: { id: sharedAsset.revisions[0].id },
      data: { normalisedBlobPath: sharedPath },
    });
    chk('once a library revision serves it, it is not',
      (await consumption.blobServedByLibrary(sharedPath)) === true,
      'publishCompanyVideoToLibrary points the revision at the video’s own MP4');
    chk('null is not a shared path', (await consumption.blobServedByLibrary(null)) === false);

    /* ─────────────────────────────────────────────────────────────────────── */
    console.log('\nTHE SOURCE SAYS WHAT IT DOES');
    const bp = code('services/inductionContent/buildPhase.ts');
    chk('the flag is compared to exactly "1"',
      /INDUCTION_CONTENT_RESET_ENABLED === '1'/.test(bp));
    const vs = code('services/inductionVideo/inductionVideoService.ts');
    chk('the published refusal is OUTSIDE the flag block',
      /if \(video\.publishedAt \|\| video\.status === InductionVideoStatus\.PUBLISHED\)/.test(vs) &&
      vs.indexOf('video.publishedAt || video.status === InductionVideoStatus.PUBLISHED') <
        vs.indexOf('if (!contentResetEnabled())'),
      'evidence is checked before the flag is ever consulted');
    chk('the watched refusal is outside it too',
      vs.indexOf('video._count.views > 0') < vs.indexOf('if (!contentResetEnabled())'));
    const ls = code('services/inductionVideo/libraryAssetService.ts');
    chk('the asset delete asks assetDeletion rather than deleting bare',
      /const deletion = await assetDeletion\(assetId\);/.test(ls) &&
      /if \(!deletion\.deletable\)/.test(ls));
    /*
     * BOTH PREDICATES ROUTE THEIR EVIDENCE CHECK THROUGH ONE FUNCTION. They used to
     * be literally the same function, which made the mandatory refusal block the
     * Start again it recommends. Split, the invariant is no longer "same predicate"
     * but "same shared refusal" — so that is what is asserted.
     */
    chk('  and resetLibraryAsset asks assetReset, not the delete predicate',
      /const reset = await assetReset\(assetId\);/.test(ls) &&
      !/const deletion = await assetDeletion\(assetId\);[\s\S]{0,400}cannot be started again/.test(ls));
    chk('  and BOTH predicates share one evidence refusal',
      /function sharedContentRefusal/.test(ls) &&
      (ls.match(/sharedContentRefusal\(state\)/g) ?? []).length >= 2,
      'so neither can be used to get round the other');
    /*
     * SCOPED TO THE FUNCTION BODY. A whole-file index comparison failed here
     * because `contentResetEnabled()` also appears earlier, in
     * `discardLibraryRevision` — the assertion was measuring the wrong two
     * positions, not a real ordering problem.
     */
    const shared = (() => {
      const at = ls.indexOf('function sharedContentRefusal');
      if (at < 0) return '';
      const rest = ls.slice(at);
      const nxt = rest.indexOf('\nexport ', 1);
      return nxt > 0 ? rest.slice(0, nxt) : rest;
    })();
    chk('  which checks evidence before it consults the flag',
      shared.length > 0 &&
      shared.indexOf('state.consumed') >= 0 &&
      shared.indexOf('contentResetEnabled()') > shared.indexOf('state.consumed'),
      'no flag can reach a refusal about somebody’s induction record');
  } finally {
    strict();
    // Productions first: they cascade from the asset anyway, but a stray one from a
    // failed assertion would otherwise be left behind with the asset gone.
    await prisma.inductionVideo.deleteMany({ where: { id: { in: madeVideos } } });
    await prisma.libraryAsset.deleteMany({ where: { id: { in: madeAssets } } });
    await prisma.inductionModule.deleteMany({ where: { id: { in: madeModules } } });
    // The worker last: its view rows cascade from it, and from the videos above.
    await prisma.worker.deleteMany({ where: { id: worker.id } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
