export {};
/**
 * THE WHOLE MODULE PAGE, RENDERED AND MEASURED AT REAL VIEWPORT SIZES.
 *
 * ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────────
 *
 * It IS the real `ModuleDetail` component, server-rendered, inside a shell that
 * reproduces what sits above it in production — the app header, the breadcrumb row
 * and `max-w-6xl` main padding — so the "is the button above the fold" question is
 * asked against the same vertical stack a signed-in user meets.
 *
 * It is NOT a screenshot of production. Nothing here can sign in, so this cannot
 * reach the live page. Styling comes from the Tailwind CDN configured with the
 * project's own tokens rather than from the app's compiled stylesheet: class coverage
 * is the same, but it is a faithful reconstruction, not the article itself.
 *
 * Each file writes its own measurements into `#measure`, so a headless run can read
 * the numbers back with --dump-dom instead of anybody eyeballing a picture.
 *
 * Run: npx tsx scripts/module_page_shots.tsx <outdir>
 */
const Module = require('module');
const React = require('react');

(globalThis as unknown as { React: unknown }).React = React;
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
const { writeFileSync, mkdirSync, readFileSync } = require('fs');
const { join } = require('path');
const { ModuleDetail } = require('../components/inductionModules/ModuleDetail');
const { moduleStatus } = require('../services/inductionModules/moduleStatus');

const outDir = process.argv[2] ?? 'module-shots';
mkdirSync(outDir, { recursive: true });

function rootVars(): string {
  const css = readFileSync('app/globals.css', 'utf8');
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1].trim() : '';
}

const WORDING =
  'This company has been building since 1998, and every site we run works the same way. '
  + 'Your supervisor is the first person to ask about anything you are not sure of. '
  + 'We would always rather stop and check than carry on and guess.';

const rev = (over: Record<string, unknown> = {}) => ({
  id: 'rev-1', version: 1, status: 'ISSUED', heading: 'Who we are, and how we work',
  narration: WORDING, preparedByName: 'J Carter', preparedByRealm: 'Platform',
  preparedOn: '29 Sep 2026', issuedByName: 'J Carter', issuedByRealm: 'Platform',
  issuedOn: '29 Sep 2026', issueNote: 'First version, reviewed and adopted.',
  supersededOn: null, events: [], ...over,
});

/** A whole module page, at one stage. */
const detailFor = (
  title: string,
  slug: string,
  video: Record<string, unknown>,
  over: Record<string, unknown> = {},
) => {
  // `null` means genuinely nothing issued; `undefined` means "use the default".
  // Conflating them made a module with no wording render the chip "Live · rev 1".
  const issued =
    over.issued === null ? null : ((over.issued as { version: number } | undefined) ?? { version: 1 });
  const draft = (over.draft as { version: number } | null | undefined) ?? null;
  return {
    id: 'm1', slug, title, category: 'SAFETY', order: 5,
    mandatory: true, defaultIncluded: true, active: true, replacesSceneType: null,
    status: moduleStatus({ active: true, issued, draft }),
    usage: {
      onProjects: 6, totalProjects: 6, excludedBy: [],
      overriddenBy: [{ siteId: 's1', siteName: 'Dorchester Road' }],
    },
    inForce: { heading: 'Who we are, and how we work', narration: WORDING, version: 1, isDraft: false },
    draftId: draft ? 'rev-2' : null,
    issueConsequence: draft
      ? 'Issuing revision 2 makes it what operatives are told on all 6 active projects.'
      : null,
    retireConsequence: 'Retiring it removes this subject from 6 active projects.',
    standsInFor: null,
    deletion: {
      deletable: false,
      blockedReason: 'This is a standard company subject, so it is kept even while its content is being rewritten.',
      issuedRevisions: 1, draftRevisions: draft ? 1 : 0, siteDecisions: 1, unlinkedAssets: [],
    },
    reset: {
      resettable: true, blockedReason: null, revisions: 1, productions: 0,
      siteDecisionsKept: 1, producedVideos: [], wouldLeaveSubjectSilent: true,
    },
    draftDiscard: draft ? { revisionId: 'rev-2', version: 2, leavesNothingWritten: false } : null,
    buildPhaseNotice: null,
    video,
    revisions: draft ? [rev({ id: 'rev-2', version: 2, status: 'DRAFT', issuedOn: null, issueNote: null }), rev()] : [rev()],
    ...over,
  };
};

const S = (over: Record<string, unknown>) => ({
  stage: 'READY_TO_NARRATE', step: 3, label: 'Generate narration',
  detail: 'The wording is in force. Turn it into a video by reading it aloud first.',
  working: false,
  next: { label: 'Generate the narration', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
  videoId: null, assetId: null, live: false, ...over,
});

const PAGES: { file: string; note: string; detail: Record<string, unknown> }[] = [
  {
    file: '01-step1-write-wording',
    note: 'Behavioural Standards — brand new, nothing written',
    detail: detailFor('Behavioural Standards', 'BEHAVIOURAL_STANDARDS', S({
      stage: 'NO_WORDING', step: 1, label: 'Write wording',
      detail: 'Write what this module should say. Nothing is generated until you issue it, so a draft reaches nobody.',
      next: { label: 'Write the wording', action: null, directorOnly: false, estimate: null },
    }), { issued: null, inForce: null, draftId: null, revisions: [] }),
  },
  {
    file: '02-step2-issue-wording',
    note: 'Accident & Near-Miss Reporting — a draft waiting to be issued',
    detail: detailFor('Accident & Near-Miss Reporting', 'ACCIDENT_REPORTING', S({
      stage: 'WORDING_DRAFT', step: 2, label: 'Issue wording',
      detail: 'Draft revision 2 is written but not issued, so there is nothing to narrate yet.',
      next: { label: 'Issue the wording', action: null, directorOnly: true, estimate: null },
    }), { draft: { version: 2 } }),
  },
  {
    file: '03-step3-ready-to-narrate',
    note: 'Company Introduction — wording live. THE OLD DEAD END',
    detail: detailFor('Company Introduction', 'COMPANY_INTRODUCTION', S({})),
  },
  {
    file: '04-step3-narrating',
    note: 'Company Introduction — narrating, page polls itself',
    detail: detailFor('Company Introduction', 'COMPANY_INTRODUCTION', S({
      stage: 'NARRATING', step: 3, working: true, videoId: 'v1', next: null,
      detail: 'Reading the wording aloud and writing the subtitles. This page updates itself when it finishes.',
    })),
  },
  {
    file: '05-step4-review-narration',
    note: 'Company Introduction — narrated, ready to build',
    detail: detailFor('Company Introduction', 'COMPANY_INTRODUCTION', S({
      stage: 'NARRATION_REVIEW', step: 4, label: 'Review narration', videoId: 'v1',
      detail: 'Listen to the narration and read the subtitles. When they are right, build the video.',
      next: { label: 'Generate the video', action: 'generateVideo', directorOnly: true, estimate: 'about two minutes' },
    })),
  },
  {
    file: '06-step6-preview',
    note: 'Company Introduction — preview. THE TALLEST CARD (player + note field)',
    detail: detailFor('Company Introduction', 'COMPANY_INTRODUCTION', S({
      stage: 'PREVIEW', step: 6, label: 'Preview video', videoId: 'v1',
      detail: 'Watch it through before it goes live. Publishing puts it in front of operatives in place of the written wording.',
      next: { label: 'Publish & issue', action: 'publishAndIssue', directorOnly: true, estimate: null },
    })),
  },
  {
    file: '07-step8-live',
    note: 'Company Introduction — live, nothing left to do',
    detail: detailFor('Company Introduction', 'COMPANY_INTRODUCTION', S({
      stage: 'LIVE', step: 8, label: 'Live', live: true, next: null,
      detail: 'The video is live. Operatives are shown it in place of the written wording.',
    })),
  },
];

/**
 * The chrome above the page in production: the app header bar and the breadcrumb row.
 * Reproduced because the fold question is about the whole stack, not the card alone.
 */
const SHELL_TOP = `
  <header class="border-b border-line bg-surface">
    <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm font-bold text-ink">SiteComply</span>
      <span class="text-xs text-ink-subtle">Signed in</span>
    </div>
  </header>
  <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
    <nav class="mb-2 text-sm text-ink-subtle">Induction videos › Company modules › …</nav>`;

for (const page of PAGES) {
  const body = renderToStaticMarkup(
    React.createElement(ModuleDetail, {
      detail: page.detail,
      canDraft: true,
      canIssue: true,
      endpoint: '/api/platform/induction-modules',
      backHref: '/platform/dashboard/induction-videos/modules',
      libraryBasePath: '/platform/dashboard/induction-videos/library',
      videoApiBase: '/api/platform/induction-video',
    }),
  );

  const doc = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.note}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: { colors: {
    brand:{50:'rgb(var(--brand-50)/<alpha-value>)',100:'rgb(var(--brand-100)/<alpha-value>)',200:'rgb(var(--brand-200)/<alpha-value>)',300:'rgb(var(--brand-200)/<alpha-value>)',500:'rgb(var(--brand-500)/<alpha-value>)',600:'rgb(var(--brand-600)/<alpha-value>)',700:'rgb(var(--brand-700)/<alpha-value>)',800:'rgb(var(--brand-800)/<alpha-value>)'},
    safe:{50:'rgb(var(--safe-50)/<alpha-value>)',200:'rgb(var(--safe-500)/<alpha-value>)',500:'rgb(var(--safe-500)/<alpha-value>)',600:'rgb(var(--safe-600)/<alpha-value>)',700:'rgb(var(--safe-700)/<alpha-value>)'},
    danger:{50:'rgb(var(--danger-50)/<alpha-value>)',200:'rgb(var(--danger-500)/<alpha-value>)',300:'rgb(var(--danger-500)/<alpha-value>)',500:'rgb(var(--danger-500)/<alpha-value>)',600:'rgb(var(--danger-600)/<alpha-value>)',700:'rgb(var(--danger-700)/<alpha-value>)'},
    hivis:{400:'rgb(var(--hivis-400)/<alpha-value>)',500:'rgb(var(--hivis-500)/<alpha-value>)'},
    ink:{DEFAULT:'rgb(var(--ink)/<alpha-value>)',muted:'rgb(var(--ink-muted)/<alpha-value>)',subtle:'rgb(var(--ink-subtle)/<alpha-value>)'},
    line:'rgb(var(--line)/<alpha-value>)',
    surface:{DEFAULT:'rgb(var(--surface)/<alpha-value>)',sunken:'rgb(var(--surface-sunken)/<alpha-value>)'},
  } } } };
</script>
<style>
  :root { ${rootVars()} }
  body { background: rgb(var(--surface-sunken)); margin: 0; }
  .shadow-card { box-shadow: 0 1px 2px rgb(15 23 42 / .06), 0 1px 3px rgb(15 23 42 / .1); }
  .touch-target { min-height: 44px; }
  /* A broken src renders 300x150; a real induction video is portrait 1080x1920. The
     measurement must be made against the real shape or the fold test is flattered. */
  video { aspect-ratio: 1080 / 1920; }
  /* The measurement strip is not part of the page; it sits fixed and is cropped out
     of the screenshots by design — it exists only for --dump-dom. */
  #measure { position: fixed; bottom: 0; right: 0; font: 11px monospace;
             background: #000; color: #0f0; padding: 2px 6px; z-index: 9999; }
</style>
</head>
<body>
${SHELL_TOP}
${body}
  </main>
<div id="measure">measuring…</div>
<script>
  // Run after Tailwind's CDN pass has applied, or every box is unstyled and 0-height.
  setTimeout(function () {
    var card = document.querySelector('section.border-2');
    var btn = card && card.querySelector('button');
    var vh = window.innerHeight, vw = window.innerWidth;
    function box(el) { if (!el) return null; var r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; }
    var c = box(card), b = box(btn);
    var out = {
      viewport: vw + 'x' + vh,
      cardTop: c && c.top, cardBottom: c && c.bottom, cardHeight: c && c.h,
      actionBottom: b && b.bottom,
      cardFullyAboveFold: c ? c.bottom <= vh : null,
      actionAboveFold: b ? b.bottom <= vh : null,
      pageHeight: Math.round(document.body.scrollHeight),
    };
    document.getElementById('measure').textContent = 'MEASURE ' + JSON.stringify(out);
  }, 1200);
</script>
</body></html>`;

  writeFileSync(join(outDir, `${page.file}.html`), doc);
}

console.log(`\n  wrote ${PAGES.length} full page(s) to ${outDir}\n`);
for (const p of PAGES) console.log(`    ${p.file}  —  ${p.note}`);
console.log();
