export {};
/**
 * THE LIBRARY INDEX, ACTUALLY RENDERED.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Every other check in this repository reads source or calls a service. None of
 * them renders anything, and that gap has now cost twice in one day:
 *
 *  1. a function prop passed from a Server Component threw before rendering, and
 *     tsc, the build and nine suites all passed;
 *  2. the whole new page structure was gated on `assets.length > 0`, so on an empty
 *     library the page looked exactly as it had before - and every string assertion
 *     still passed, because the strings were in the bundle, merely never shown.
 *
 * String presence is not rendering. This renders the component to HTML and looks at
 * what comes out, with the EMPTY library production actually has.
 *
 * Run: npx tsx scripts/library_render_verify.tsx
 */
const Module = require('node:module');
const React = require('react');
/*
 * Next compiles JSX with the automatic runtime, so the component files never import
 * React. tsx compiles them with the CLASSIC runtime, whose output calls
 * React.createElement by name - hence "React is not defined" unless it is global.
 * Putting it on globalThis is the smallest thing that makes a real render possible
 * here; it changes nothing about how the component behaves in the application.
 */
(globalThis as unknown as { React: unknown }).React = React;

// The component is a client component: stub the Next hooks it reaches for.
const stubs: Record<string, unknown> = {
  'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
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
const { readFileSync } = require('node:fs');
const { LibrarySection } = require('../components/inductionVideo/LibrarySection');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const MODULES = [
  { id: 'm1', title: 'Company introduction', slug: 'COMPANY_INTRODUCTION',
    category: 'BEHAVIOUR', hasIssued: false },
  { id: 'm2', title: 'PPE expectations', slug: 'PPE_EXPECTATIONS',
    category: 'SAFETY', hasIssued: true },
];

const render = (assets: unknown[], modules: unknown[] = MODULES) =>
  renderToStaticMarkup(
    React.createElement(LibrarySection, {
      assets,
      modules,
      canDraft: true,
      canIssue: true,
      endpoint: '/api/platform/induction-library',
      totalProjects: 3,
      basePath: '/platform/dashboard/induction-videos/library',
    }),
  ) as string;

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'a1', slug: 'COMPANY_INTRO', title: 'Company introduction', description: null,
  placement: 'OPENING', category: 'COMPANY_CULTURE', provenance: 'UPLOADED',
  status: { key: 'LIVE', label: 'Live · revision 1', detail: 'd', tone: 'good',
    reachesOperatives: true },
  usage: { onProjects: 3, publishedInductions: 2 },
  mandatory: false, defaultIncluded: true, active: true, moduleTitle: null,
  issued: { version: 1, issuedOn: '1 Jan 2026', issuedByName: 'Dee', issuedByRealm: null,
    durationLabel: '1m 30s' },
  draft: null, ...over,
});

console.log('\nAN EMPTY LIBRARY — WHAT PRODUCTION ACTUALLY HAS');
const empty = render([]);
chk('the page renders at all', empty.length > 500, `${empty.length} bytes`);
chk('it states what the Library is for',
  empty.includes('Reusable company footage every project'));
chk('it says there is nothing yet', empty.includes('No library videos yet.'));
chk('the way in is offered', empty.includes('Add a library video'));
// THE REGRESSION THIS FILE WAS WRITTEN FOR.
for (const band of ['Opening', 'Company standards', 'Closing']) {
  chk(`the "${band}" part of the induction is shown even with nothing in it`,
    empty.includes(band),
    'gating the structure on having assets made a new library look untouched');
}
chk('each empty part says so itself',
  (empty.match(/Nothing plays here yet\./g) ?? []).length === 3,
  `${(empty.match(/Nothing plays here yet\./g) ?? []).length} of 3 bands`);
chk('and each explains WHEN it plays',
  empty.includes('Before the site welcome') &&
    empty.includes('After the site information, before the site rules') &&
    empty.includes('At the end, before sign-off'));
chk('the filter bar is NOT shown, because there is nothing to filter',
  !empty.includes('Any subject'),
  'controls that can only return nothing are noise');

console.log('\nA CATALOGUE THAT GREW AFTER YOU SEEDED IT');
/*
 * The "create the standard modules" button only rendered when there were NONE, so a
 * company that had already seeded could never receive one added later. That is what
 * happened when Company Introduction joined the set: production had six modules, the
 * seventh could not be created by anything in the product, and a user building a
 * "Company Introduction" library video was left picking PPE expectations as its
 * source — producing a company introduction made of PPE content.
 */
const { ModulesIndex } = require('../components/inductionModules/ModulesIndex');
const { MODULE_CATALOGUE } = require('../services/inductionModules/moduleCatalogue');
const { moduleStatus } = require('../services/inductionModules/moduleStatus');
/*
 * A row as moduleRowsForIndex builds one. The STATUS comes from the real derivation
 * rather than a literal: a fixture that hard-coded a label would keep passing after
 * the vocabulary changed, which is the whole class of bug moduleStatus exists to stop.
 */
const asModule = (
  c: { slug: string; title: string },
  over: Record<string, unknown> = {},
) => {
  const issued = (over.issued as { version: number } | null | undefined) ?? null;
  const draft = (over.draft as { version: number } | null | undefined) ?? null;
  const active = over.active === undefined ? true : Boolean(over.active);
  return {
    id: c.slug, slug: c.slug, title: c.title, category: 'SAFETY',
    mandatory: false, defaultIncluded: true, active, replacesSceneType: null,
    status: moduleStatus({ active, issued, draft }),
    issued: issued
      ? { version: issued.version, issuedOn: '24 Sep 2026', issuedByName: 'JC', issuedByRealm: 'Platform' }
      : null,
    draft: draft ? { id: `${c.slug}-d`, version: draft.version, preparedByName: 'JC' } : null,
    revisionCount: (issued ? 1 : 0) + (draft ? 1 : 0),
    usage: { onProjects: issued ? 6 : 0, totalProjects: 6, excludedBy: 0 },
    standsInFor: null,
    ...over,
  };
};
const renderModules = (mods: unknown[]) =>
  renderToStaticMarkup(
    React.createElement(ModulesIndex, {
      modules: mods, canDraft: true, canIssue: true,
      endpoint: '/api/platform/induction-modules',
      basePath: '/platform/dashboard/induction-videos/modules',
      libraryBasePath: '/platform/dashboard/induction-videos/library',
    }),
  ) as string;

const allButIntro = MODULE_CATALOGUE
  .filter((c: { slug: string }) => c.slug !== 'COMPANY_INTRODUCTION')
  .map(asModule);
const incomplete = renderModules(allButIntro);
chk('a catalogue missing one standard module says so',
  /One standard module is missing/.test(incomplete),
  'production had six of seven and nothing in the product could add the seventh');
chk('  and names it', /Company introduction/.test(incomplete));
chk('  and offers to add it', /Add it to my modules/.test(incomplete));
chk('  reassuring that nothing written is touched',
  /nothing you have already written is touched/i.test(incomplete));
const complete = renderModules(MODULE_CATALOGUE.map(asModule));
chk('a complete catalogue does NOT nag',
  !/standard module is missing|standard modules are missing/.test(complete),
  'a prompt that never goes away is noise');
const emptyCatalogue = renderModules([]);
chk('an empty catalogue still offers the whole set',
  new RegExp(`Create the ${MODULE_CATALOGUE.length} standard modules`).test(emptyCatalogue),
  'the label said "six" while the set had seven');

console.log('\nTHE MODULE IS OFFERED BEFORE THE TITLE, AND SAYS WHEN IT IS NOT READY');
/*
 * THE PROBLEM THIS FIXES. A user could create a library video called "Company
 * introduction" and find the only module on offer was "PPE expectations" — because
 * the picker hid every module without issued wording, and PPE was the one that had
 * it. The obvious next step produced a company introduction made of PPE content.
 */
const { LibraryCreatePanel } = require('../components/inductionVideo/LibraryCreatePanel');
const { EMPTY_LIBRARY_DRAFT } = require('../components/inductionVideo/LibraryCreatePanel');
const renderCreate = (modules: unknown[] = MODULES, provenance = 'GENERATED') =>
  renderToStaticMarkup(
    React.createElement(LibraryCreatePanel, {
      modules,
      modulesHref: '/platform/dashboard/induction-videos/modules',
      busy: false,
      onCreate: () => {},
      initialDraft: { ...EMPTY_LIBRARY_DRAFT, provenance },
    }),
  ) as string;
const creating = renderCreate();
chk('an unissued module is LISTED, not hidden',
  creating.includes('Company introduction'),
  'hiding it reads as "that topic does not exist" when somebody just has to issue it');
chk('  and is marked as not ready', /not issued yet/.test(creating));
chk('a module with issued wording is offered plainly',
  creating.includes('PPE expectations'));
const uploading = renderCreate(MODULES, 'UPLOADED');
chk('the uploaded branch does NOT ask which module it is',
  !uploading.includes('Which company module is this video?'),
  'uploaded footage is not produced from anything');
// Scoped to the OPTIONS. A bare includes() matched the Title field's placeholder,
// which happens to read "Company introduction" — the assertion was wrong, not the code.
const optionsIn = (html: string) =>
  (html.match(/<option[^>]*>([\s\S]*?)<\/option>/g) ?? []).join(' ');
chk('  and offers only ISSUED modules to stand in for',
  optionsIn(uploading).includes('PPE expectations') &&
    !optionsIn(uploading).includes('Company introduction'),
  'an unissued module reaches nobody, so there is nothing to displace');
chk('the generated branch offers BOTH, marking the unissued one',
  optionsIn(creating).includes('Company introduction') &&
    optionsIn(creating).includes('PPE expectations'));
chk('the module question is asked BEFORE the title',
  creating.indexOf('Which company module is this video?') > 0 &&
    creating.indexOf('Which company module is this video?') < creating.indexOf('Short reference'),
  'the module is what the video IS; the title follows from it');
const noModules = renderCreate([], 'GENERATED');
chk('with no modules at all, it says to write one first',
  /There are no company modules yet/.test(noModules) &&
    /Company modules/.test(noModules),
  'an empty picker with no explanation is a dead end');

console.log('\nCHOOSING THE MODULE FILLS IN WHAT IT IMPLIES');
const { applyModuleToDraft } = require('../components/inductionVideo/LibraryCreatePanel');
const intro = MODULES[0];
const blank = { ...EMPTY_LIBRARY_DRAFT, provenance: 'GENERATED' };
const filled = applyModuleToDraft(blank, intro);
chk('the title comes from the module', filled.title === 'Company introduction',
  'this is what stops a "Company introduction" made of PPE wording');
chk('  and the reference', filled.slug === 'COMPANY_INTRODUCTION');
chk('  and a sensible subject', filled.category === 'COMPANY_CULTURE',
  `${filled.category}`);
const typed = applyModuleToDraft(
  { ...blank, title: 'Our people', slug: 'OUR_PEOPLE', category: 'BEHAVIOUR' }, intro);
chk('what somebody typed is never overwritten',
  typed.title === 'Our people' && typed.slug === 'OUR_PEOPLE' && typed.category === 'BEHAVIOUR',
  'a form that rewrites your words is worse than one that lets you fix a mismatch');
chk('clearing the choice clears the link but keeps the words',
  applyModuleToDraft({ ...blank, title: 'Kept' }, undefined).moduleId === '' &&
    applyModuleToDraft({ ...blank, title: 'Kept' }, undefined).title === 'Kept');

console.log('\nTHE SERVER SENDS EVERY MODULE, NOT ONLY THE ISSUED ONES');
const rowsSrc = readFileSync('services/inductionVideo/libraryRows.ts', 'utf8');
chk('libraryRows no longer filters the picker down to issued modules',
  !/modules\.filter\(\(m\) => m\.issued\)/.test(rowsSrc),
  'filtering there is what made the wanted module invisible in the first place');
chk('  and sends each one\'s readiness instead',
  /hasIssued: Boolean\(m\.issued\)/.test(rowsSrc));

console.log('\nONE ASSET — THE SUMMARY A MANAGER READS');
const one = render([asset()]);
chk('the title appears', one.includes('Company introduction'));
chk('its status chip appears', one.includes('Live · revision 1'));
chk('its subject and provenance appear',
  one.includes('Company &amp; culture') && one.includes('Uploaded'));
chk('usage is on the row, not hidden on another page',
  one.includes('On 3 of 3 projects') && one.includes('in 2 published inductions'),
  'the figures nothing used to show at all');
chk('it links to its own page',
  one.includes('/platform/dashboard/induction-videos/library/a1'),
  'built from basePath — a callback here is what took the page down');
chk('the filter bar IS shown now', one.includes('Any subject'));
chk('it sits under the band it plays in',
  one.indexOf('Opening') < one.indexOf('Company introduction'));

console.log('\nA RETIRED ASSET IS STILL HONEST');
const retired = render([asset({
  active: false,
  status: { key: 'RETIRED', label: 'Retired', detail: 'd', tone: 'neutral',
    reachesOperatives: false },
})]);
chk('a retired asset is hidden by default', !retired.includes('Company introduction'),
  'it reaches nobody, so it is not in the working list');
chk('  but the page says it is there and can be shown',
  retired.includes('Show retired'));


console.log('\nA PRODUCTION UNDER WAY IS ON THE PAGE — THE WEDGE MADE VISIBLE');
/*
 * THE DEFECT THIS RENDERS. `startCompanyVideo` refuses a second production while an
 * unpublished one exists, and nothing displayed that production: the asset page
 * loaded revisions only, and project listings are `where: { jobSiteId }` while a
 * company video has none. The only route to one was the redirect fired once when
 * Produce was pressed.
 *
 * Production, 2026-09-29: the Company Introduction asset held a SCRIPT_READY
 * production built from PPE EXPECTATIONS, created before the asset was re-pointed at
 * the new module. Unfinishable (wrong wording) and undeletable (no link). Clearing it
 * took hand-written SQL.
 *
 * A source assertion cannot catch this, because the strings were never the problem -
 * the section did not exist. So it is rendered.
 */
const { LibraryAssetDetail } = require('../components/inductionVideo/LibraryAssetDetail');

const production = (over: Record<string, unknown> = {}) => ({
  id: 'v1', version: 1, status: 'SCRIPT_READY', startedOn: '29 Sep 2026', sceneCount: 3,
  fromModuleId: 'm1', fromModuleTitle: 'Company introduction', fromModuleVersion: 1,
  mismatched: false, stale: false, discardable: true, blockedReason: null, ...over,
});

const detailFixture = (over: Record<string, unknown> = {}) => ({
  id: 'a1', slug: 'COMPANY_INTRO', title: 'Company Introduction', description: null,
  category: 'COMPANY_CULTURE', provenance: 'GENERATED', placement: 'OPENING', order: 0,
  mandatory: false, defaultIncluded: true, active: true,
  moduleId: 'm1', moduleTitle: 'Company introduction',
  status: { key: 'EMPTY', label: 'Nothing yet', detail: 'd', tone: 'neutral',
    reachesOperatives: false },
  usage: { onProjects: 0, totalProjects: 3, switchedOffBy: [], revisions: [],
    publishedTotal: 0 },
  retireConsequence: 'r', issueConsequence: null,
  revisions: [], productions: [], draftId: null,
  band: [{ id: 'a1', title: 'Company Introduction', order: 0, active: true }],
  ...over,
});

const renderDetail = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(LibraryAssetDetail, {
      asset: detailFixture(over),
      modules: [{ id: 'm1', title: 'Company introduction', hasIssued: true }],
      canDraft: true, canIssue: true,
      endpoint: '/api/platform/induction-library',
      backHref: '/platform/dashboard/induction-videos/library',
      videoHrefBase: '/platform/dashboard/induction-videos',
    }),
  ) as string;

const idle = renderDetail();
chk('with nothing under way the page renders', idle.length > 500, `${idle.length} bytes`);
chk('  and says nothing about a production', !idle.includes('Under way'),
  'a section that is always there is noise');
chk('  and offers to produce the video', idle.includes('Produce the video from this module'));

const busy = renderDetail({ productions: [production()] });
chk('an in-flight production IS SHOWN', busy.includes('Under way'),
  'THE regression: this section did not exist and the asset looked idle while wedged');
chk('  named by version', busy.includes('Version 1'));
chk('  with its stage', busy.includes('Ready for review'),
  'from the shared status badge, not a second set of words');
chk('  when it started and how big it is',
  busy.includes('29 Sep 2026') && busy.includes('3 scenes'));
chk('  the module it came from', busy.includes('Company introduction'));
chk('  A LINK TO OPEN IT', busy.includes('/platform/dashboard/induction-videos/v1'),
  'the one thing whose absence made the error unactionable');
chk('  and a way to discard it', busy.includes('Discard it'));
chk('the Produce button is disabled while one runs',
  /Produce the video from this module<\/button>/.test(busy) && busy.includes('disabled'),
  'walking into a refusal the panel above already explains');
chk('  and the reason is stated, not just the disabling',
  busy.includes('is already being produced'));

const wrong = renderDetail({
  moduleTitle: 'PPE expectations', moduleId: 'm2',
  productions: [production({ mismatched: true, fromModuleTitle: 'Company introduction' })],
});
chk('A MISMATCHED PRODUCTION SAYS SO IN FULL',
  wrong.includes('produced from the wrong module'),
  'exactly what happened in production, and the state that made "finish it" wrong advice');
chk('  naming what it was built from', wrong.includes('Company introduction'));
chk('  and what the asset points at now', wrong.includes('PPE expectations'));
chk('  and telling you to discard rather than finish',
  /discard it and produce a new one/i.test(wrong));

const held = renderDetail({
  productions: [production({ discardable: false, blockedReason: 'Something is still running on it.' })],
});
chk('a production that cannot be discarded says why',
  held.includes('Something is still running on it.') && !held.includes('Discard it'),
  'offering a button the service would refuse is worse than explaining');

const viewerOnly = renderToStaticMarkup(
  React.createElement(LibraryAssetDetail, {
    asset: detailFixture({ productions: [production()] }),
    modules: [{ id: 'm1', title: 'Company introduction', hasIssued: true }],
    canDraft: false, canIssue: false,
    endpoint: '/api/platform/induction-library',
    backHref: '/platform/dashboard/induction-videos/library',
    videoHrefBase: '/platform/dashboard/induction-videos',
  }),
) as string;
chk('somebody who may only read still SEES the production',
  viewerOnly.includes('Under way') &&
    viewerOnly.includes('/platform/dashboard/induction-videos/v1'),
  'hiding the explanation from a viewer recreates the dead end for them');
chk('  but is offered no discard', !viewerOnly.includes('Discard it'),
  'irreversible, so it belongs with the roles that own the record');


console.log('\nTHE MODULES LIST IS A LIST — NO WORDING ON IT');
/*
 * THE COMPLAINT THIS ANSWERS. Every module printed its whole narration here: about
 * 2,400 words across seven modules before a single click, growing with the catalogue.
 * The wording moved to modules/[moduleId]; these assertions are what stop it coming
 * back, and what prove the row still says enough to choose by.
 */
const PPE_WORDING =
  'Your personal protective equipment is the last thing between you and an injury.';
const listRows = [
  asModule({ slug: 'COMPANY_INTRODUCTION', title: 'Company introduction' },
    { draft: { version: 1 } }),
  asModule({ slug: 'PPE_EXPECTATIONS', title: 'PPE expectations' },
    { issued: { version: 1 }, mandatory: true,
      standsInFor: { assetId: 'a1', title: 'PPE — site footage' } }),
  asModule({ slug: 'HOUSEKEEPING', title: 'Housekeeping' }, { issued: { version: 2 } }),
  asModule({ slug: 'OLD_ONE', title: 'Retired subject' },
    { issued: { version: 1 }, active: false }),
];
const list = renderModules(listRows);
chk('the list renders', list.length > 500, `${list.length} bytes`);
chk('every module is named', ['Company introduction', 'PPE expectations', 'Housekeeping']
  .every((t) => list.includes(t)));
chk('NO narration appears anywhere on it', !list.includes(PPE_WORDING),
  'this is the clutter the whole change exists to remove');
chk('each row links to its own page',
  list.includes('/platform/dashboard/induction-videos/modules/PPE_EXPECTATIONS'),
  'built from basePath — a callback here is what took the Library index down');
chk('the columns a manager chooses by are there',
  ['Module', 'Status', 'Included', 'Subject', 'Used on'].every((h) => list.includes(h)));
chk('a draft is shown as reaching nobody',
  list.includes('Draft · rev 1') && list.includes('Reaches nobody'),
  'the property that let a placeholder module sit in production looking issued');
chk('an issued module shows its revision', list.includes('Issued · rev 1'));
chk('usage is on the row', list.includes('6 of 6 projects'));
chk('a video standing in for a module is declared',
  list.includes('A library video stands in for this'),
  'otherwise a module reads as reaching six projects when a film is what plays');
chk('a retired module is hidden by default', !list.includes('Retired subject'),
  'it reaches nobody, so it is not in the working list');
chk('  but the page says it can be shown', list.includes('Show retired'));
chk('mandatory and default inclusion are distinguished',
  list.includes('Every site') && list.includes('On by default'));

console.log('\nONE MODULE\'S PAGE CARRIES WHAT THE LIST DROPPED');
const { ModuleDetail } = require('../components/inductionModules/ModuleDetail');
const moduleFixture = (over: Record<string, unknown> = {}) => ({
  id: 'm-ppe', slug: 'PPE_EXPECTATIONS', title: 'PPE expectations', category: 'SAFETY',
  order: 10, mandatory: true, defaultIncluded: true, active: true, replacesSceneType: null,
  status: moduleStatus({ active: true, issued: { version: 1 }, draft: { version: 2 } }),
  usage: { onProjects: 6, totalProjects: 6, excludedBy: [], overriddenBy: [
    { siteId: 's1', siteName: 'Dorchester Road' } ] },
  inForce: { heading: 'What we expect of your PPE', narration: PPE_WORDING, version: 1,
    isDraft: false },
  draftId: 'rev-2',
  issueConsequence: 'Issuing revision 2 makes it what operatives are told on all 6 active projects.',
  retireConsequence: 'Retiring it removes this subject from 6 active projects.',
  standsInFor: null,
  revisions: [
    { id: 'rev-2', version: 2, status: 'DRAFT', heading: 'What we expect of your PPE',
      narration: 'A reworded draft.', preparedByName: 'JC', preparedByRealm: 'Platform',
      preparedOn: '29 Sep 2026', issuedByName: null, issuedByRealm: null, issuedOn: null,
      issueNote: null, supersededOn: null, events: [] },
    { id: 'rev-1', version: 1, status: 'ISSUED', heading: 'What we expect of your PPE',
      narration: PPE_WORDING, preparedByName: 'JC', preparedByRealm: 'Platform',
      preparedOn: '24 Sep 2026', issuedByName: 'JC', issuedByRealm: 'Platform',
      issuedOn: '24 Sep 2026', issueNote: 'First issue', supersededOn: null,
      events: [{ id: 'e1', action: 'ISSUED', actorName: 'JC', actorRealm: 'Platform',
        detail: 'Version 1', at: '24 Sep 2026, 09:14' }] },
  ],
  ...over,
});
const renderModuleDetail = (over: Record<string, unknown> = {}, can = true) =>
  renderToStaticMarkup(
    React.createElement(ModuleDetail, {
      detail: moduleFixture(over), canDraft: can, canIssue: can,
      endpoint: '/api/platform/induction-modules',
      backHref: '/platform/dashboard/induction-videos/modules',
      libraryBasePath: '/platform/dashboard/induction-videos/library',
    }),
  ) as string;

const detail = renderModuleDetail();
chk('the detail page renders', detail.length > 800, `${detail.length} bytes`);
chk('THE WORDING IS HERE', detail.includes(PPE_WORDING),
  'the list dropped it, so this page has to carry it');
chk('  with its on-screen heading', detail.includes('What we expect of your PPE'));
chk('the state is stated in words, not just a chip',
  detail.includes('is what operatives hear'),
  'live-with-a-draft is the state that needed two places to read before');
chk('usage is shown', detail.includes('6') && detail.includes('Where this module is used'));
chk('a project that recorded its own wording is named',
  detail.includes('Dorchester Road'));
chk('the revision history is listed',
  detail.includes('Revision 2') && detail.includes('Revision 1') && detail.includes('First issue'));
chk('issuing says what it will do BEFORE the button',
  detail.indexOf('makes it what operatives are told') < detail.indexOf('Issue this revision'),
  'a consequence after the action is not a consequence');
chk('retiring says what it will do too',
  detail.includes('removes this subject from 6 active projects'));
chk('editing is offered to somebody who may draft',
  detail.includes('Continue the draft'));
const readOnly = renderModuleDetail({}, false);
chk('a read-only viewer sees the wording', readOnly.includes(PPE_WORDING));
chk('  but is offered no edit, issue or retire',
  !readOnly.includes('Continue the draft') && !readOnly.includes('Issue this revision') &&
    !readOnly.includes('Retire this module'),
  'the service refuses them anyway; the screen should not dangle the button');
const standin = renderModuleDetail({
  standsInFor: { assetId: 'a1', title: 'PPE — site footage', hasIssuedRevision: true },
});
chk('a video standing in for the module is explained on the page',
  standin.includes('A library video stands in for this module') &&
    standin.includes('/platform/dashboard/induction-videos/library/a1'),
  'the wording is still edited here, but it is not what plays');
const notIssuedStandin = renderModuleDetail({
  standsInFor: { assetId: 'a1', title: 'PPE — site footage', hasIssuedRevision: false },
});
chk('  and an unissued stand-in says the wording still wins',
  notIssuedStandin.includes('still what projects hear'),
  'a video set to replace a module but never issued replaces nothing');



console.log('\nTHE ATTENTION SUMMARY SITS ABOVE THE LIST WITHOUT TAKING IT OVER');
/*
 * The owner asked for "a small status area at the top" rather than Option D's full
 * layout. Rendered here because the thing that makes it small is what it does NOT
 * draw: nothing when quiet, four items at most when busy.
 */
const { AttentionSummary } = require('../components/inductionVideo/AttentionSummary');
const renderAttention = (attention: unknown) =>
  renderToStaticMarkup(
    React.createElement(AttentionSummary, {
      attention,
      modulesBasePath: '/platform/dashboard/induction-videos/modules',
      libraryBasePath: '/platform/dashboard/induction-videos/library',
      videoBasePath: '/platform/dashboard/induction-videos',
    }),
  ) as string;
const attentionItem = (over: Record<string, unknown> = {}) => ({
  key: 'module:m1:unissued', severity: 'action',
  title: '“Company introduction” reaches nobody',
  detail: 'Never issued, so it reaches nobody.',
  target: { kind: 'module', id: 'm1' }, action: 'Read it and issue it', ...over,
});
chk('a quiet summary draws nothing whatsoever',
  renderAttention({ items: [], actionCount: 0 }) === '',
  'a strip that is always there stops being read');
const busyStrip = renderAttention({ items: [attentionItem()], actionCount: 1 });
chk('one action reads as one thing needing you', /1 thing needs you/.test(busyStrip));
chk('  it names the subject', busyStrip.includes('reaches nobody'));
chk('  and links to that module',
  busyStrip.includes('/platform/dashboard/induction-videos/modules/m1'),
  'joined from the base path this tier passed in');
const noteOnly = renderAttention({
  items: [attentionItem({ key: 'a:1', severity: 'watch', title: 'Revision 2 is prepared',
    target: { kind: 'asset', id: 'a1' }, action: 'Review it' })],
  actionCount: 0,
});
chk('notes alone do not claim anything needs you', /Worth knowing/.test(noteOnly) &&
  !/needs you/.test(noteOnly),
  'crying wolf over a note is how a strip loses its meaning');
chk('  and a note links to its asset',
  noteOnly.includes('/platform/dashboard/induction-videos/library/a1'));


console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
