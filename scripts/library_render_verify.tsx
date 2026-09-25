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
const { LibrarySection } = require('../components/inductionVideo/LibrarySection');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const render = (assets: unknown[]) =>
  renderToStaticMarkup(
    React.createElement(LibrarySection, {
      assets,
      modules: [],
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
