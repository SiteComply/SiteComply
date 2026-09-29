export {};
/**
 * THE ATTENTION SUMMARY: what needs somebody, above the list.
 *
 * Option A gave the lists a page per item. This is the owner's addition to it: "a
 * small status area at the top highlighting things that require action, such as draft
 * modules, missing library videos, unpublished content or failed generations" — a
 * lightweight summary, explicitly NOT the full Option D layout.
 *
 * THE PROPERTIES:
 *   IT INVENTS NO THIRD OPINION  "reaches nobody" is asked of moduleStatus and
 *                                libraryStatus, the same derivations the rows render.
 *   IT NAMES THE REAL FAILURES   the ones this product has actually had: an unissued
 *                                module, a mismatched production, a failed job.
 *   IT DISAPPEARS WHEN QUIET     no all-clear panel taking up the top of the page.
 *   THE CLOSED LINE IS COUNTS    one chip per category, no item titles.
 *   A KIND AND AN ID, NOT A URL  the service is tier-agnostic; the component joins.
 *
 * Run: npx tsx scripts/attention_summary_verify.ts
 */
const Module = require('node:module');
const React = require('react');
(globalThis as unknown as { React: unknown }).React = React;
const stubs: Record<string, unknown> = {
  'next/link': {
    __esModule: true,
    default: ({ children, href }: { children?: unknown; href?: string }) =>
      React.createElement('a', { href }, children as never),
  },
};
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request in stubs) return stubs[request];
  return origLoad.apply(this, [request, parent, isMain]);
};

const { renderToStaticMarkup } = require('react-dom/server');
const { prisma } = require('../lib/prisma');
const att = require('../services/inductionVideo/attentionService');
const svc = require('../services/inductionModules/inductionModuleService');
const { moduleStatus } = require('../services/inductionModules/moduleStatus');
const { libraryStatus } = require('../services/inductionVideo/libraryStatus');
const { MODULE_CATALOGUE } = require('../services/inductionModules/moduleCatalogue');
const { moduleActorFromPlatformViewer } = require('../services/inductionModules/moduleActor');
const { AttentionSummary } = require('../components/inductionVideo/AttentionSummary');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const director = moduleActorFromPlatformViewer(
  { id: 'asv', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] } as never);

const TAG = `ASV_${process.pid}`;
const WORDING =
  'Everyone on this site wears a hard hat, boots and a hi-vis vest at all times, and ' +
  'tells their supervisor at once if any of it is damaged.';

const madeModules: string[] = [];
const madeAssets: string[] = [];
const madeVideos: string[] = [];

const render = (attention: unknown) =>
  renderToStaticMarkup(
    React.createElement(AttentionSummary, {
      attention,
      modulesBasePath: '/platform/dashboard/induction-videos/modules',
      libraryBasePath: '/platform/dashboard/induction-videos/library',
      videoBasePath: '/platform/dashboard/induction-videos',
    }),
  ) as string;

/*
 * An explicit shape rather than a generic: everything here arrives through `require`,
 * so the argument is `any` and a constrained generic infers its CONSTRAINT - which
 * erased every field but `key` and failed tsc while the suite itself passed.
 */
interface Item {
  key: string;
  severity: string;
  title: string;
  detail: string;
  target: { kind: string; id?: string };
  action: string;
}
const mine = (items: Item[], needle: string): Item[] =>
  items.filter((i) => i.key.includes(needle));

(async () => {
  try {
    console.log('\nIT DISAPPEARS WHEN THERE IS NOTHING TO SAY');
    chk('an empty summary renders nothing at all',
      render({ items: [], actionCount: 0, counts: [] }) === '',
      // A strip that is always there stops being read; its presence has to mean something.
      'no all-clear panel taking up the top of the page every day');

    console.log('\nA MODULE THAT REACHES NOBODY IS NAMED');
    const m = await prisma.inductionModule.create({
      data: { slug: `${TAG}_UNISSUED`, title: `${TAG} Never issued`, order: 95 },
      select: { id: true },
    });
    madeModules.push(m.id);
    const d = await svc.startDraft(director, m.id);
    await svc.saveDraft(director, d.value.revisionId,
      { heading: 'Draft heading', narration: WORDING });

    let a = await att.attentionItems();
    const unissued = mine(a.items, `module:${m.id}`);
    chk('the unissued module produces an item', unissued.length === 1);
    chk('  it is an action, not a note', unissued[0].severity === 'action');
    chk('  it says it reaches nobody', /reaches nobody/i.test(unissued[0].title),
      unissued[0].title);
    chk('  its detail is the SAME sentence the row and the page show',
      unissued[0].detail ===
        moduleStatus({ active: true, issued: null, draft: { version: 1 } }).detail,
      // A strip with its own idea of "not live" would contradict the chip beneath it.
      'asked of moduleStatus, never restated');
    chk('  and it points at that module', unissued[0].target.kind === 'module' &&
      unissued[0].target.id === m.id);
    chk('  telling you to issue it, because a draft exists',
      /issue it/i.test(unissued[0].action), unissued[0].action);

    console.log('\nONCE ISSUED, IT STOPS BEING MENTIONED');
    await svc.issueRevision(director, d.value.revisionId, 'for the suite');
    a = await att.attentionItems();
    chk('the item is gone', mine(a.items, `module:${m.id}`).length === 0,
      'an item that outlives the problem is how a strip becomes noise');

    console.log('\nA LIBRARY VIDEO NOBODY CAN SEE IS NAMED');
    const asset = await prisma.libraryAsset.create({
      data: {
        slug: `${TAG}_ASSET`, title: `${TAG} Empty video`, provenance: 'UPLOADED',
        placement: 'COMPANY_BAND',
      },
      select: { id: true },
    });
    madeAssets.push(asset.id);
    a = await att.attentionItems();
    const empty = mine(a.items, `asset:${asset.id}`);
    chk('it produces an item', empty.length === 1);
    chk('  it is an action', empty[0].severity === 'action');
    chk('  it says it is in no induction', /not in any induction/i.test(empty[0].title),
      empty[0].title);
    chk('  its detail comes from libraryStatus',
      empty[0].detail === libraryStatus({ active: true, issued: null, draft: null }).detail,
      'the same vocabulary the Library list and detail page use');
    chk('  and it points at the asset', empty[0].target.kind === 'asset');

    console.log('\nA FAILED JOB IS NAMED, AND SAYS RETRYING IS SAFE');
    const mod2 = await prisma.inductionModule.create({
      data: { slug: `${TAG}_SRC`, title: `${TAG} Source`, order: 96 },
      select: { id: true },
    });
    madeModules.push(mod2.id);
    const d2 = await svc.startDraft(director, mod2.id);
    await svc.saveDraft(director, d2.value.revisionId,
      { heading: 'Source heading', narration: WORDING });
    await svc.issueRevision(director, d2.value.revisionId, 'for the suite');
    const genAsset = await prisma.libraryAsset.create({
      data: {
        slug: `${TAG}_GEN`, title: `${TAG} Generated`, provenance: 'GENERATED',
        placement: 'OPENING', moduleId: mod2.id,
      },
      select: { id: true },
    });
    madeAssets.push(genAsset.id);
    const video = await prisma.inductionVideo.create({
      data: {
        scope: 'COMPANY', libraryAssetId: genAsset.id, version: 1, status: 'SCRIPT_READY',
        sourceModuleRevisionId: d2.value.revisionId,
      },
      select: { id: true },
    });
    madeVideos.push(video.id);
    const job = await prisma.inductionVideoJob.create({
      data: { videoId: video.id, kind: 'RENDER', status: 'FAILED', error: 'ffmpeg exited 1' },
      select: { id: true },
    });

    a = await att.attentionItems();
    const failed = mine(a.items, `job:${job.id}`);
    chk('the failed render produces an item', failed.length === 1);
    chk('  it is an action', failed[0].severity === 'action');
    chk('  it names what failed', /rendering/i.test(failed[0].title), failed[0].title);
    chk('  it carries the reason', /ffmpeg exited 1/.test(failed[0].detail));
    chk('  and says trying again is safe', /trying again is safe/i.test(failed[0].detail),
      'the approval and the narration are untouched by a failed render');
    chk('  pointing at the version', failed[0].target.kind === 'video' &&
      failed[0].target.id === video.id);

    console.log('\nAN UNFINISHED PRODUCTION IS A NOTE, NOT AN ALARM');
    const unfinished = mine(a.items, `video:${video.id}:unfinished`);
    chk('it produces an item', unfinished.length === 1);
    chk('  at watch severity, because nothing is broken', unfinished[0].severity === 'watch',
      'it is half-done, which is normal while somebody is working');
    chk('  and it explains why it blocks a second one',
      /one production runs at a time/i.test(unfinished[0].detail));

    console.log('\nA PRODUCTION FROM THE WRONG MODULE IS AN ALARM');
    // Re-point the asset: exactly what wedged Company Introduction in production.
    await prisma.libraryAsset.update({
      where: { id: genAsset.id }, data: { moduleId: madeModules[0] },
    });
    a = await att.attentionItems();
    const mism = mine(a.items, `video:${video.id}:mismatched`);
    chk('the mismatch produces its own item', mism.length === 1,
      'worse than unfinished: finishing it publishes the wrong subject');
    chk('  it is an action', mism[0].severity === 'action');
    chk('  it names the module the wording really came from',
      mism[0].detail.includes(`${TAG} Source`), mism[0].detail);
    chk('  and says to discard rather than finish',
      /discard it and produce a new one/i.test(mism[0].detail));
    chk('  the plain "unfinished" item is NOT also shown',
      mine(a.items, `video:${video.id}:unfinished`).length === 0,
      'two items about one production is the noise this has to avoid');

    console.log('\nA MISSING STANDARD MODULE IS NAMED');
    const present = await prisma.inductionModule.findMany({ select: { slug: true } });
    const missingNow = MODULE_CATALOGUE.filter(
      (c: { slug: string }) => !present.some((p: { slug: string }) => p.slug === c.slug));
    const missingItem = mine(a.items, 'modules:missing-standard');
    chk(`the catalogue gap is reported when there is one (${missingNow.length} missing)`,
      missingNow.length > 0 ? missingItem.length === 1 : missingItem.length === 0);
    if (missingNow.length > 0) {
      chk('  and it reassures that nothing written is touched',
        /nothing you have written is touched/i.test(missingItem[0].detail));
    }

    console.log('\nACTIONS ARE COUNTED, AND SORTED AHEAD OF NOTES');
    chk('actionCount counts only actions',
      a.actionCount === a.items.filter((i: { severity: string }) => i.severity === 'action').length);
    const firstWatch = a.items.findIndex((i: { severity: string }) => i.severity === 'watch');
    const lastAction = a.items.map((i: { severity: string }) => i.severity)
      .lastIndexOf('action');
    chk('every action comes before every note',
      firstWatch === -1 || lastAction < firstWatch,
      `last action at ${lastAction}, first note at ${firstWatch}`);

    console.log('\nTHE STRIP RENDERS, IS CAPPED, AND LINKS PER TIER');
    const html = render(a);
    chk('it renders', html.length > 200, `${html.length} bytes`);
    chk('the heading counts what needs doing',
      new RegExp(`${a.actionCount} needs? action`).test(html), 'headline says the number');
    chk('it links into the Platform tier',
      html.includes('/platform/dashboard/induction-videos/'),
      'built from the base paths its tier passes in');
    const many = {
      items: Array.from({ length: 9 }, (_, i) => ({
        key: `k${i}`, category: 'DRAFT_MODULE', severity: 'action', title: `Item ${i}`,
        detail: 'd', target: { kind: 'modules' }, action: 'Go',
      })),
      actionCount: 9,
      counts: [{ category: 'DRAFT_MODULE', label: '9 modules in draft', count: 9,
        severity: 'action' }],
    };
    const nine = render(many);
    /*
     * THE CAP IS GONE, AND THAT IS THE POINT. It existed because the item rows were
     * always on screen; behind a <details> they cost nothing until somebody asks, and
     * a truncated expansion would be a worse answer than a long one. What has to stay
     * small is the CLOSED line: nine drafts collapse to one chip, so the strip is the
     * same height whether there is one problem or thirty.
     */
    chk('nine items collapse to ONE count chip on the summary line',
      nine.includes('9 modules in draft') && (nine.match(/Item \d/g) ?? []).length === 9,
      'the summary line is counts; the items are behind the disclosure');
    const summaryLine = nine.slice(nine.indexOf('<summary'), nine.indexOf('</summary>'));
    chk('  and no item title appears on that line',
      !/Item \d/.test(summaryLine),
      'anything on the closed line is what the page costs when nothing is wrong');
    chk('  which stays one line however many there are',
      (summaryLine.match(/9 modules in draft/g) ?? []).length === 1);
    chk('expanding shows every one of them, untruncated',
      Array.from({ length: 9 }, (_, i) => `Item ${i}`).every((t) => nine.includes(t)),
      'a capped expansion would hide work somebody went looking for');
    chk('the disclosure is native, so no JavaScript is needed to open it',
      nine.includes('<details') && nine.includes('<summary'),
      'a useState toggle would turn a summary line into a client bundle');
    const adminHtml = renderToStaticMarkup(
      React.createElement(AttentionSummary, {
        attention: a,
        modulesBasePath: '/admin/induction-videos/modules',
        libraryBasePath: '/admin/induction-videos/library',
        videoBasePath: '/admin/induction-videos',
      }),
    ) as string;
    chk('the Admin Centre gets admin links',
      adminHtml.includes('/admin/induction-videos/') &&
        !adminHtml.includes('/platform/dashboard/'),
      'one component, each tier passing its own paths');

    console.log('\nIT IS WIRED IN, AND STAYS A SERVER COMPONENT');
    for (const p of ['app/platform/dashboard/induction-videos/modules/page.tsx',
                     'app/admin/(dashboard)/induction-videos/modules/page.tsx',
                     'app/platform/dashboard/induction-videos/library/page.tsx',
                     'app/admin/(dashboard)/induction-videos/library/page.tsx']) {
      const src = code(p);
      chk(`${p.replace(/^app\//, '')} mounts it`, /<AttentionSummary/.test(src));
      chk('  and loads it alongside the rows, not in series',
        /Promise\.all\(\[/.test(src),
        'two sequential awaits would add a round trip to every page load');
    }
    const comp = read('components/inductionVideo/AttentionSummary.tsx');
    chk('the component is NOT a client component',
      !comp.includes("'use client'"),
      'it has no state and no handlers, so nothing needs to ship to the browser');
    chk('  and it takes base paths, never a link builder',
      /modulesBasePath: string/.test(comp) && !/=> string/.test(comp.split('export function')[0]),
      'a function prop across the boundary is what took the Library index down');
    const svcSrc = code('services/inductionVideo/attentionService.ts');
    chk('the service asks moduleStatus and libraryStatus',
      /moduleStatus\(/.test(svcSrc) && /libraryStatus\(/.test(svcSrc),
      'never a third opinion about what reaches anybody');
    chk('  and builds no URLs itself',
      !/\/platform\/|\/admin\//.test(svcSrc),
      'a tier-aware service would need two copies of every href');
  } finally {
    await prisma.inductionVideo.deleteMany({ where: { id: { in: madeVideos } } });
    await prisma.libraryAsset.deleteMany({ where: { id: { in: madeAssets } } });
    await prisma.inductionModule.deleteMany({ where: { id: { in: madeModules } } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
