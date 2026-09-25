export {};
/**
 * THE LIBRARY IS NAVIGABLE, AND SAYS WHAT IT IS DOING.
 *
 * What this protects, in the order the problems were:
 *  - the page explains the feature, and keeps explaining it once assets exist;
 *  - one status vocabulary, derived, shared by both tiers and both views;
 *  - usage is answerable - projects, published inductions, per revision;
 *  - a consequence is stated BEFORE a retire or an issue, not after;
 *  - two axes: where it plays and what it is about;
 *  - a generated asset's CONTENT is not editable here, enforced in the service.
 *
 * Run: npx tsx scripts/library_ia_verify.ts
 */
const { prisma } = require('../lib/prisma');
const lib = require('../services/inductionVideo/libraryAssetService');
const { libraryStatus, LIBRARY_STATUS_FILTERS } = require('../services/inductionVideo/libraryStatus');
const tax = require('../services/inductionVideo/libraryTaxonomy');
const usageSvc = require('../services/inductionVideo/libraryUsage');
const { libraryAssetDetail } = require('../services/inductionVideo/libraryDetail');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const director = moduleActorFromPlatformViewer(
  { id: 'ia', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);

const SLUG = 'IA_TEST_ASSET';
const GEN_SLUG = 'IA_TEST_GENERATED';

const st = (over: Record<string, unknown> = {}) =>
  libraryStatus({ active: true, issued: null, draft: null, ...over });
const draft = (over: Record<string, unknown> = {}) => ({
  version: 1, hasFootage: true, normalised: true, hasCaptions: true, normaliseError: null, ...over,
});

(async () => {
  await prisma.libraryAsset.deleteMany({ where: { slug: { in: [SLUG, GEN_SLUG] } } });
  try {
    console.log('\nONE STATUS VOCABULARY, DERIVED AND SHARED');
    const INDEX = read('components/inductionVideo/LibrarySection.tsx');
    const DETAIL = read('components/inductionVideo/LibraryAssetDetail.tsx');
    chk('nothing stores a status column',
      !/status\s+LibraryAssetStatus/.test(read('prisma/schema.prisma')),
      'a stored status is a second source of truth that drifts on the first failed transcode');
    chk('the index reads the shared derivation',
      /from '@\/services\/inductionVideo\/libraryStatus'/.test(INDEX));
    chk('  and the detail page renders the SAME derived status',
      /asset\.status/.test(DETAIL) &&
        /libraryStatus\(/.test(read('services/inductionVideo/libraryDetail.ts')),
      'the component shows what the loader derived; it does not re-derive it');
    chk('every state has a filter', LIBRARY_STATUS_FILTERS.length >= 8,
      `${LIBRARY_STATUS_FILTERS.length} states`);

    console.log('\nTHE STATES A MANAGER ACTUALLY SEES');
    chk('nothing at all reads as not started', st().key === 'NO_FOOTAGE');
    chk('footage being converted reads as preparing',
      st({ draft: draft({ normalised: false }) }).key === 'PREPARING');
    chk('a failed conversion says so, not "preparing"',
      st({ draft: draft({ normalised: false, normaliseError: 'bad codec' }) }).key
        === 'PREPARATION_FAILED');
    chk('missing captions is its own state, because it blocks issuing',
      st({ draft: draft({ hasCaptions: false }) }).key === 'NEEDS_CAPTIONS');
    chk('complete and unissued reads as ready to issue',
      st({ draft: draft() }).key === 'READY_TO_ISSUE');
    chk('  and is honest that it reaches nobody yet',
      st({ draft: draft() }).reachesOperatives === false);
    chk('issued reads as live', st({ issued: { version: 2 } }).key === 'LIVE');
    chk('LIVE WITH A REPLACEMENT IN PROGRESS is ONE state',
      st({ issued: { version: 2 }, draft: draft() }).key === 'LIVE_WITH_DRAFT',
      'the commonest case, and it used to need two blocks joined up by the reader');
    chk('  and it still says the live revision is what projects get',
      /revision 2/.test(st({ issued: { version: 2 }, draft: draft() }).detail));
    chk('retired beats everything, including a live revision',
      st({ active: false, issued: { version: 2 } }).key === 'RETIRED' &&
        st({ active: false, issued: { version: 2 } }).reachesOperatives === false,
      'the question is "does this reach anybody", and for a retired asset it is no');

    console.log('\nTWO AXES: WHERE IT PLAYS, AND WHAT IT IS ABOUT');
    chk('there is a category for each subject the owner named',
      ['COMPANY_CULTURE', 'PPE', 'BEHAVIOUR', 'MANUAL_HANDLING', 'HOUSEKEEPING',
       'ENVIRONMENT', 'REPORTING'].every((k) =>
        tax.LIBRARY_CATEGORIES.some((c: { key: string }) => c.key === k)));
    chk('category is separate from placement',
      !/placement/i.test(JSON.stringify(tax.LIBRARY_CATEGORIES)),
      'a manager looking for the PPE video should not need to know which band it is in');
    chk('the index groups by where it plays',
      /BANDS\.map\(\(band\) => \{/.test(INDEX) &&
        /shown\.filter\(\(a\) => a\.placement === band\.key\)/.test(INDEX),
      'the filter alone sits INSIDE the map body, so it survives mapping over nothing');
    chk('  and shows the running order on the asset page',
      /asset\.band\.map/.test(DETAIL),
      'placement was a label; it is now the order you can see');
    // Matching the word found my own comment explaining why Prisma must not be here.
    // Match an IMPORT, which is the thing that would actually ship it to the browser.
    const taxSrc = read('services/inductionVideo/libraryTaxonomy.ts')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    chk('the taxonomy module imports nothing at all',
      !/^import /m.test(taxSrc),
      'a value import from anything that reaches the database would ship the client');

    console.log('\nSEARCH AND FILTERING');
    // Word-bounded: a bare includes('setStatus') also matches 'setStatusX', so a
    // renamed-away filter slipped through the first version of this suite.
    for (const [what, setter] of [
      ['free text', 'setQ'],
      ['subject', 'setCategory'],
      ['uploaded or generated', 'setProvenance'],
      ['status', 'setStatus'],
      ['retired visibility', 'setShowRetired'],
    ] as const) {
      chk(`the index filters by ${what}`,
        new RegExp(`\\b${setter}\\(`).test(INDEX));
    }
    chk('search covers the reference and the module it stands in for',
      /a\.slug\.toLowerCase\(\)/.test(INDEX) && /a\.moduleTitle/.test(INDEX));

    console.log('\nWHERE IS IT USED — answerable at last');
    const a = await lib.createLibraryAsset(director, {
      slug: SLUG, title: 'IA test video', placement: 'COMPANY_BAND', category: 'PPE',
      mandatory: false,
    });
    chk('an asset can be created with a category', a.ok === true, a.error ?? '');
    const assetId = a.value.assetId;
    const stored = await prisma.libraryAsset.findUnique({ where: { id: assetId } });
    chk('  and the category is persisted', stored.category === 'PPE', stored.category);
    chk('  and it defaults to uploaded, not generated', stored.provenance === 'UPLOADED');

    const u = await usageSvc.libraryAssetUsage(assetId);
    chk('usage counts projects', typeof u.onProjects === 'number' && u.totalProjects >= 0,
      `${u.onProjects} of ${u.totalProjects}`);
    chk('  and published inductions', u.publishedTotal === 0,
      'a new asset is in none, which is the only safe starting answer');
    chk('  and reports per revision', Array.isArray(u.revisions));

    // A real induction containing a real revision. Checking the shape of an empty
    // array proved nothing: a mutation that hard-coded every count to zero passed.
    const rev1 = await lib.startRevision(director, assetId);
    const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    const vid = await prisma.inductionVideo.create({
      data: {
        jobSiteId: site.id,
        version: 9910,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        scenes: {
          create: {
            sceneType: 'LIBRARY_SEGMENT', order: 0, heading: 'IA test', narration: '',
            required: true, libraryRevisionId: rev1.value.revisionId,
          },
        },
      },
    });
    try {
      const withUse = await usageSvc.libraryAssetUsage(assetId);
      chk('a published induction containing a revision IS counted',
        withUse.publishedTotal === 1, `${withUse.publishedTotal}`);
      const perRev = withUse.revisions.find(
        (r: { revisionId: string }) => r.revisionId === rev1.value.revisionId);
      chk('  and attributed to the right revision',
        perRev?.publishedInductions === 1 && perRev?.projects === 1,
        JSON.stringify(perRev));
      const detailWithUse = await libraryAssetDetail(assetId);
      const dRev = detailWithUse.revisions.find(
        (r: { id: string }) => r.id === rev1.value.revisionId);
      chk('  and the asset page carries that figure, not a zero',
        dRev?.usage.publishedInductions === 1, JSON.stringify(dRev?.usage));
      const batchWithUse = await usageSvc.libraryUsageSummaries();
      chk('  and the index summary agrees with the detail page',
        batchWithUse.byAsset.get(assetId)?.publishedInductions === 1,
        'two different counts of the same thing is worse than none');
    } finally {
      await prisma.inductionVideo.delete({ where: { id: vid.id } });
    }
    chk('the usage read is batched for the index',
      typeof usageSvc.libraryUsageSummaries === 'function',
      'three queries for thirty assets, not three each');
    const batch = await usageSvc.libraryUsageSummaries();
    chk('  and covers every asset', batch.byAsset.has(assetId));

    console.log('\nTHE CONSEQUENCE IS STATED BEFORE THE BUTTON');
    // Two branches, and the reassuring one is the whole point: a published induction
    // is a record and does not change, so keeping company content current is safe.
    const withPublished = usageSvc.describeRetireConsequence({
      ...u, publishedTotal: 4, onProjects: 9,
    });
    chk('retiring says published inductions KEEP the video',
      /4 published inductions already contain this video and keep it/.test(withPublished) &&
        /does not change/.test(withPublished),
      withPublished);
    chk('  and says what stops happening, with a number',
      /9 projects will stop including it/.test(withPublished));
    const withNone = usageSvc.describeRetireConsequence({
      ...u, publishedTotal: 0, onProjects: 0,
    });
    chk('  and when it is on nothing, says so plainly',
      /nothing changes for anybody/.test(withNone), withNone);
    chk('the live asset\'s own message is non-empty and names a number',
      /\d/.test(usageSvc.describeRetireConsequence(u)),
      usageSvc.describeRetireConsequence(u));
    chk('issuing explains which projects pick it up',
      /reaches nobody|will pick up revision 3/.test(usageSvc.describeIssueConsequence(u, 3)),
      usageSvc.describeIssueConsequence(u, 3));
    chk('a retire consequence is shown on the page',
      /retireConsequence/.test(DETAIL));
    chk('an issue consequence is shown beside the issue button',
      /issueConsequence/.test(DETAIL));

    console.log('\nTHE DETAIL PAGE EXISTS, FOR BOTH TIERS');
    for (const p of [
      'app/platform/dashboard/induction-videos/library/[assetId]/page.tsx',
      'app/admin/(dashboard)/induction-videos/library/[assetId]/page.tsx',
    ]) {
      chk(`${p.split('/')[1]} has an asset page`, Boolean(read(p)));
      chk(`  and it renders the SHARED component`, /<LibraryAssetDetail/.test(read(p)),
        'two copies of this page would drift the moment one was changed');
    }
    const d = await libraryAssetDetail(assetId);
    chk('the detail loader returns the asset', d !== null && d.id === assetId);
    chk('  with its status', Boolean(d.status?.key));
    chk('  its usage', typeof d.usage.onProjects === 'number');
    chk('  and its band, so the running order is visible',
      Array.isArray(d.band) && d.band.some((b: { id: string }) => b.id === assetId));

    console.log('\nYOU CAN WATCH WHAT YOU UPLOADED');
    chk('the page has a player', /<video/.test(DETAIL),
      'the Library had none: you could upload, issue and publish a video and never see it');
    chk('a preview URL is issued by the server, scoped and short-lived',
      /previewUrlForRevision/.test(read('services/inductionVideo/libraryActions.ts')) &&
        /mediaSasUrl\(path, 30\)/.test(read('services/inductionVideo/libraryAssetService.ts')),
      'footage must never become a public URL');
    const noFootage = await lib.previewUrlForRevision(director, 'no-such-revision');
    chk('  and it refuses a revision that does not exist', noFootage.ok === false);

    console.log('\nA GENERATED ASSET IS NOT EDITABLE HERE');
    chk('one predicate decides it', tax.contentEditableHere('UPLOADED') === true &&
      tax.contentEditableHere('GENERATED') === false);
    const g = await lib.createLibraryAsset(director, {
      slug: GEN_SLUG, title: 'IA generated video', placement: 'COMPANY_BAND', mandatory: false,
    });
    const genId = g.value.assetId;
    await prisma.libraryAsset.update({ where: { id: genId }, data: { provenance: 'GENERATED' } });
    const gr = await lib.startRevision(director, genId);
    const blocked = await lib.attachUpload(director, gr.value.revisionId, {
      kind: 'VIDEO', blobPath: 'library/x/y/source.mp4', fileName: 'source.mp4', bytes: 10,
    });
    chk('uploading footage over a generated video is REFUSED by the service',
      blocked.ok === false && /generated from a company module/i.test(blocked.error ?? ''),
      blocked.error ?? 'it was accepted');
    chk('  and the refusal says what to do instead',
      /edit the module and generate the video again/i.test(blocked.error ?? ''));
    chk('the page hides the upload controls too',
      /editableContent && asset\.active/.test(DETAIL),
      'the service is the guard; the screen should not offer what the service will refuse');
    chk('  and explains where the content lives',
      /generated from a Company Module/.test(DETAIL));
    chk('metadata stays editable for a generated asset',
      /canIssue && \(/.test(DETAIL) && !/editableContent[\s\S]{0,80}Settings/.test(DETAIL),
      'category and placement are about where it is used, not what it says');

    console.log('\nTHE PAGE SAYS WHAT THE LIBRARY IS FOR');
    chk('the purpose is in the header, not only the empty state',
      /Reusable company footage that every project/.test(INDEX));
    chk('  and the empty state still explains the alternative',
      /built entirely from that\s*\n?\s*project’s own information/.test(INDEX) ||
        /project’s own information/.test(INDEX));
    chk('creation asks where the video comes from FIRST',
      /Where will the video come from\?/.test(INDEX),
      'the answer decides everything else about the asset');
    chk('  and the generated option is honest that it is not available yet',
      /not available yet/.test(INDEX),
      'an option that silently fails is worse than one that explains itself');
    chk('  and says the module stays the source of truth',
      /source of truth/.test(INDEX));
    chk('the caption requirement is stated up front, not at issue time',
      /needs a video file[\s\S]{0,120}caption file/.test(DETAIL));
  } finally {
    await prisma.libraryAsset.deleteMany({ where: { slug: { in: [SLUG, GEN_SLUG] } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
