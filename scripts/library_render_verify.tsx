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
  empty.includes('Reusable company footage that every project'));
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

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
