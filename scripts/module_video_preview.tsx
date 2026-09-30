export {};
/**
 * RENDER THE VIDEO PANEL AT EVERY STAGE, TO ONE HTML FILE YOU CAN OPEN.
 *
 * Not a screenshot: nothing in this toolchain can sign in or drive a browser. This is
 * the real component, rendered by React to static markup with the project's own colour
 * tokens inlined, so what you see is what the page produces — the same technique
 * `library_render_verify.tsx` uses to catch render-time crashes, pointed at a file
 * instead of at assertions.
 *
 * Run: npx tsx scripts/module_video_preview.tsx [outfile]
 */
const Module = require('module');
const React = require('react');
/*
 * The panel is a client component: React must be global for the classic JSX runtime,
 * and the Next hooks it reaches for have to be stubbed or `useRouter` throws
 * "invariant expected app router to be mounted". Same shim as
 * library_render_verify.tsx — kept identical on purpose so the two harnesses cannot
 * drift into rendering the same component under different conditions.
 */
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
const { writeFileSync, readFileSync } = require('fs');
const {
  ModuleVideoPanel,
} = require('../components/inductionModules/ModuleVideoPanel');

const out = process.argv[2] ?? 'module-video-stages.html';

/** The project's own tokens, lifted from globals.css so the colours are real. */
function rootVars(): string {
  const css = readFileSync('app/globals.css', 'utf8');
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1].trim() : '';
}

const stage = (over: Record<string, unknown>) => ({
  stage: 'READY_TO_NARRATE',
  step: 3,
  label: 'Generate narration',
  detail: '',
  working: false,
  next: null,
  videoId: null,
  assetId: null,
  live: false,
  ...over,
});

/** Every stage a Director can land on, in the order they meet them. */
const STAGES: { note: string; video: Record<string, unknown> }[] = [
  {
    note: 'A brand-new module. Nothing written, so nothing to make a video of.',
    video: stage({
      stage: 'NO_WORDING', step: 1, label: 'Write wording',
      detail: 'Write what this module should say. Nothing is generated until you issue it, so a draft reaches nobody.',
      next: { label: 'Write the wording', action: null, directorOnly: false, estimate: null },
    }),
  },
  {
    note: 'Wording written but not issued. A draft reaches nobody.',
    video: stage({
      stage: 'WORDING_DRAFT', step: 2, label: 'Issue wording',
      detail: 'Draft revision 1 is written but not issued, so there is nothing to narrate yet.',
      next: { label: 'Issue the wording', action: null, directorOnly: true, estimate: null },
    }),
  },
  {
    note: 'THE OLD DEAD END. This is where the flow used to stop with nothing to click.',
    video: stage({
      detail: 'The wording is in force. Turn it into a video by reading it aloud first.',
      next: { label: 'Generate the narration', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
    }),
  },
  {
    note: 'Narrating. The page polls and advances itself; no refresh, no button.',
    video: stage({
      stage: 'NARRATING', step: 3, working: true, videoId: 'v1',
      detail: 'Reading the wording aloud and writing the subtitles. This page updates itself when it finishes.',
    }),
  },
  {
    note: 'Narrated. Check it before spending a render.',
    video: stage({
      stage: 'NARRATION_REVIEW', step: 4, label: 'Review narration', videoId: 'v1',
      detail: 'Listen to the narration and read the subtitles. When they are right, build the video.',
      next: { label: 'Generate the video', action: 'generateVideo', directorOnly: true, estimate: 'about two minutes' },
    }),
  },
  {
    note: 'Rendering. The estimate is said out loud so two minutes does not read as a hang.',
    video: stage({
      stage: 'RENDERING', step: 5, label: 'Generate video', working: true, videoId: 'v1',
      detail: 'Building the video. This takes a couple of minutes and the page updates itself when it is done.',
    }),
  },
  {
    note: 'Preview. Watch it, say what it says, and one press publishes AND issues it.',
    video: stage({
      stage: 'PREVIEW', step: 6, label: 'Preview video', videoId: 'v1',
      detail: 'Watch it through before it goes live. Publishing puts it in front of operatives in place of the written wording.',
      next: { label: 'Publish & issue', action: 'publishAndIssue', directorOnly: true, estimate: null },
    }),
  },
  {
    note: 'Live. Nothing left to do, and the panel says what that means.',
    video: stage({
      stage: 'LIVE', step: 8, label: 'Live', live: true,
      detail: 'The video is live. Operatives are shown it in place of the written wording.',
    }),
  },
  {
    note: 'Wording re-issued after the video was made: live, but saying the older words.',
    video: stage({
      stage: 'LIVE_WORDING_MOVED_ON', step: 8, label: 'Live', live: true,
      detail: 'The video is live, but it says an earlier version of this wording. Generating again replaces it; until then operatives see the older words.',
      next: { label: 'Generate the narration again', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
    }),
  },
  {
    note: 'A failure. Trying again starts from the wording, which is unchanged.',
    video: stage({
      stage: 'FAILED', step: 3, videoId: 'v1',
      detail: 'Something went wrong while generating. Trying again starts from the wording, which is unchanged.',
      next: { label: 'Try again', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
    }),
  },
  {
    note: 'The same stage seen by a SITE MANAGER: told what is needed, offered no button.',
    video: stage({
      detail: 'The wording is in force. Turn it into a video by reading it aloud first.',
      next: { label: 'Generate the narration', action: 'generateNarration', directorOnly: true, estimate: 'about 30 seconds' },
    }),
  },
];

const blocks = STAGES.map((s, i) => {
  const html = renderToStaticMarkup(
    React.createElement(ModuleVideoPanel, {
      moduleId: 'm1',
      moduleTitle: 'Company Introduction',
      video: s.video,
      // The last case is the Site Manager view.
      canIssue: i !== STAGES.length - 1,
      endpoint: '/api/platform/induction-modules',
      videoApiBase: '/api/platform/induction-video',
    }),
  );
  return `
  <section class="mb-8">
    <p class="mb-2 text-xs font-bold uppercase tracking-wider text-ink-subtle">
      ${i + 1}. ${s.note}
    </p>
    ${html}
  </section>`;
}).join('\n');

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Company Module video — every stage</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: { extend: { colors: {
      brand: { 50:'rgb(var(--brand-50)/<alpha-value>)',100:'rgb(var(--brand-100)/<alpha-value>)',200:'rgb(var(--brand-200)/<alpha-value>)',300:'rgb(var(--brand-200)/<alpha-value>)',500:'rgb(var(--brand-500)/<alpha-value>)',600:'rgb(var(--brand-600)/<alpha-value>)',700:'rgb(var(--brand-700)/<alpha-value>)' },
      safe: { 50:'rgb(var(--safe-50)/<alpha-value>)',500:'rgb(var(--safe-500)/<alpha-value>)',600:'rgb(var(--safe-600)/<alpha-value>)',700:'rgb(var(--safe-700)/<alpha-value>)' },
      danger:{ 50:'rgb(var(--danger-50)/<alpha-value>)',300:'rgb(var(--danger-500)/<alpha-value>)',500:'rgb(var(--danger-500)/<alpha-value>)',600:'rgb(var(--danger-600)/<alpha-value>)',700:'rgb(var(--danger-700)/<alpha-value>)' },
      hivis: { 400:'rgb(var(--hivis-400)/<alpha-value>)',500:'rgb(var(--hivis-500)/<alpha-value>)' },
      ink:   { DEFAULT:'rgb(var(--ink)/<alpha-value>)', muted:'rgb(var(--ink-muted)/<alpha-value>)', subtle:'rgb(var(--ink-subtle)/<alpha-value>)' },
      line:  'rgb(var(--line)/<alpha-value>)',
      surface:{ DEFAULT:'rgb(var(--surface)/<alpha-value>)', sunken:'rgb(var(--surface-sunken)/<alpha-value>)' },
    } } }
  };
</script>
<style>
  :root { ${rootVars()} }
  body { background: rgb(var(--surface-sunken)); }
  .shadow-card { box-shadow: 0 1px 2px rgb(15 23 42 / 0.06), 0 1px 3px rgb(15 23 42 / 0.1); }
  .touch-target { min-height: 44px; }
</style>
</head>
<body class="p-6">
  <h1 class="mb-1 text-lg font-bold text-ink">Company Module video — the panel at every stage</h1>
  <p class="mb-6 max-w-2xl text-sm text-ink-muted">
    The real <code>ModuleVideoPanel</code> component, server-rendered. Every stage a
    Director can land on, in order, plus a failure and the Site Manager view. Controls
    are inert here: this is the markup the page produces, not a live app.
  </p>
  <div class="max-w-2xl">
${blocks}
  </div>
</body>
</html>`;

writeFileSync(out, doc);
console.log(`\n  wrote ${out} — ${STAGES.length} stages, ${doc.length} bytes\n`);
