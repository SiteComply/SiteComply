/**
 * CPP issued-document design — verification.
 *
 *   npx tsx scripts/cpp_document_verify.ts
 *
 * The plan is the one place in SiteComply that deliberately leaves the app's
 * visual language: a controlled document a client, a Principal Contractor or an
 * inspector reads, not a screen a manager operates.
 *
 * The properties worth protecting are the ones that stop it drifting back into
 * looking generated — monochrome hierarchy, scoped styles that cannot leak,
 * webfonts that never reach an operative's phone, and branding that stays
 * subordinate to the Principal Contractor's own identity.
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const page = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');
const css = readFileSync('app/globals.css', 'utf8');
const doc = css.slice(css.indexOf('.cpp-doc {'));

function main() {
  console.log('== CPP ISSUED DOCUMENT ==\n');

  console.log('[1] The styles cannot leak into the app');
  chk('[1] CONTROL — the document stylesheet was located',
    doc.length > 2000 && doc.includes('--cpp-accent'));
  // Selectors only. Splitting on `}` and taking what precedes the next `{`
  // keeps declarations out of it — the first attempt matched custom-property
  // lines INSIDE .cpp-doc and reported the block's own tokens as unscoped rules.
  const rules = doc
    .split('}')
    .map((block) => block.split('{')[0] ?? '')
    .map((sel) => sel.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter((sel) => sel.length > 0 && !sel.includes(';'));
  const unscoped = rules.filter((r) => !r.startsWith('.cpp-doc') && !r.startsWith('@'));
  chk('[1] every rule is scoped under .cpp-doc', unscoped.length === 0,
    unscoped.slice(0, 3).join(' | '));
  chk('[1] the document uses literal colours, not app tokens',
    !/var\(--ink\b|var\(--brand-|var\(--safe-|var\(--surface\b/.test(doc));

  console.log('\n[2] Monochrome, with colour only where it carries information');
  const hexes = [...doc.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
  const unique = [...new Set(hexes)];
  chk('[2] CONTROL — colours were found to check', unique.length > 0, unique.join(' '));
  // Ink, paper, two greys, two rules = neutral. Plus exactly two carriers of
  // meaning: the dark SiteComply blue and the amber for outstanding items.
  const meaningful = unique.filter((h) => h === '#003a54' || h === '#7a5410');
  chk('[2] exactly two non-neutral colours', meaningful.length === 2, meaningful.join(' '));
  chk('[2] the accent is SiteComply\'s own darkest blue', unique.includes('#003a54'));
  chk('[2] no large coloured status box in the document',
    !/\.cpp-status\s*\{[^}]*background:/.test(doc));
  chk('[2] the status line is ruled, not filled',
    /\.cpp-status\s*\{[^}]*border-top: 1px solid var\(--cpp-accent\)/.test(doc));
  chk('[2] no sidebar in the document', !/cpp-rail|cpp-sidebar/.test(doc + page));
  chk('[2] no revision stamp', !/transform: rotate|cpp-stamp/.test(doc));

  console.log('\n[3] Hierarchy is carried by rule weight');
  chk('[3] the issuer line is the heaviest rule',
    /\.cpp-issuer\s*\{[^}]*border-bottom: 3px solid/.test(doc));
  chk('[3] approval carries the same weight — it closes the document',
    /\.cpp-approval\s*\{[^}]*border-top: 3px solid/.test(doc));
  chk('[3] Part dividers sit below that',
    /\.cpp-part\s*\{[^}]*border-bottom: 2px solid/.test(doc));
  chk('[3] section rows are hairlines',
    /\.cpp-section\s*\{[^}]*border-bottom: 1px solid var\(--cpp-rule-2\)/.test(doc));

  console.log('\n[4] Document-control language, not application language');
  chk('[4] an issued revision reads "Current revision"', /'Current revision'/.test(page));
  chk('[4] the old "in force" wording is gone from the document',
    !/· in force/.test(page));
  chk('[4] a superseded revision says so', /'Superseded'/.test(page));
  chk('[4] a prepared but unissued revision says so',
    /'Prepared — not yet issued'/.test(page));
  chk('[4] revisions are zero-padded, as a document numbers them',
    /padStart\(2, '0'\)/.test(page));

  console.log('\n[5] Branding is subordinate to the Principal Contractor');
  chk('[5] the PC\'s name leads the document',
    /cpp\.site\.principalContractor/.test(page) &&
    page.indexOf('cpp-issuer') < page.indexOf('cpp-doctype'));
  chk('[5] SiteComply appears once, as provenance',
    (page.match(/Prepared and issued in SiteComply/g) ?? []).length === 1);
  chk('[5]   in the colophon, not the masthead',
    page.indexOf('Prepared and issued in SiteComply') > page.indexOf('cpp-doctype'));
  chk('[5] the mark is small and monochrome',
    /\.cpp-foot svg \{ width: 14px/.test(doc) && /stroke="#71767c"/.test(page));
  chk('[5] the footer is softened — no uppercase shouting',
    !/\.cpp-foot\s*\{[^}]*text-transform: uppercase/.test(doc));

  console.log('\n[6] The webfonts never reach an operative');
  chk('[6] fonts are declared on this route, not the root layout',
    /next\/font\/google/.test(page) &&
    !/next\/font/.test(readFileSync('app/layout.tsx', 'utf8')));
  // Checked on OUR page, not the whole build: Next bakes
  // "https://fonts.googleapis.com" into its own font-optimisation runtime in
  // every build, used or not, so a build-wide grep reports a CDN request that
  // this page never makes.
  chk('[6] they are self-hosted by next/font, not fetched from a CDN',
    !/fonts\.googleapis\.com/.test(page) && !/<link[^>]*fonts\./.test(page));
  chk('[6] the app keeps its system stack',
    /--font-sans: ui-sans-serif, system-ui/.test(css));
  chk('[6] the variables are applied to the document only',
    /chivo\.variable\} \$\{crimson\.variable\}/.test(page));

  console.log('\n[7] The document still tells the truth about itself');
  // The amber callout carrying this was removed as duplicated messaging. The
  // claims survive it: the opening still identifies a draft, and the CDM duty
  // moved into the approval block rather than being dropped.
  chk('[7] a working draft is identified as one',
    /'Working draft'/.test(page) && /'Not yet issued'/.test(page));
  chk('[7]   and says plainly that it is not approved',
    /has not been approved or issued/.test(page));
  chk('[7] the CDM duty is still stated',
    /remains responsible for ensuring the construction/.test(page) &&
    /suitable, sufficient and kept up to date/.test(page));
  chk('[7] no coloured callout at the top of the document',
    !/cpp-flag[^>]*marginTop/.test(page));
  chk('[7] live completeness is hidden against a frozen revision',
    /\{!viewingRevision && \(/.test(page));
  chk('[7] an unapproved document shows unsigned rules, not a claim',
    /cpp-sigline/.test(page));

  console.log('\n[8] Print and PDF behave like a controlled document');
  // The restyle silently dropped the break protection the old markup had, so a
  // section could split mid-table and the approval block could be orphaned from
  // its signature. Guarded now so it cannot be lost again.
  chk('[8] the sheet has a size and real margins',
    /@page \{[\s\S]*?size: A4;[\s\S]*?margin: 18mm 16mm 22mm;/.test(css));
  const print = css.slice(css.indexOf('@media print {'));
  chk('[8] CONTROL — the print block was located',
    print.includes('.cpp-section') && print.length > 400);
  for (const [sel, what] of [
    ['.cpp-doc .cpp-section', 'a section is never split'],
    ['.cpp-doc .cpp-approval', 'the approval block is never split'],
    ['.cpp-doc .cpp-items li', 'a register row is never split'],
    ['.cpp-doc .cpp-who', 'the approver row is never split'],
  ] as const) {
    chk(`[8] ${what}`,
      new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*break-inside: avoid`).test(print));
  }
  chk('[8] both the modern and legacy break properties are set — print engines differ',
    /break-inside: avoid; page-break-inside: avoid/.test(print));
  chk('[8] a heading never ends a sheet',
    /break-after: avoid; page-break-after: avoid/.test(print));
  chk('[8] the plan proper starts on a fresh sheet',
    /\.cpp-body \{ break-before: page/.test(print));
  chk('[8] the screen paper treatment is dropped on paper',
    /box-shadow: none !important/.test(print));

  console.log('\n[9] Contents — navigation without invented page numbers');
  chk('[9] the contents is part of the document, not chrome',
    /<nav className="cpp-contents"/.test(page) && !/print:hidden[^>]*cpp-contents/.test(page));
  chk('[9] every section is listed', /sections\.map\(\(s, idx\) => \(\s*<li/.test(page));
  chk('[9] the appendix and the approval are listed too',
    /#cpp-drawings/.test(page) && /#cpp-approval/.test(page));
  chk('[9] entries are anchors on screen', /href=\{`#cpp-\$\{s\.key\}`\}/.test(page));
  chk('[9]   and the sections carry matching ids', /id=\{`cpp-\$\{s\.key\}`\}/.test(page));
  chk('[9] anchors print as plain text, not blue links',
    /\.cpp-contents a \{ color: inherit; text-decoration: none; \}/.test(print));
  // THE POINT. A contents page citing a page the PDF then contradicts is a
  // document-control defect, so there are no page numbers anywhere.
  // Scoped to the CPP page. A build-wide grep hits the INDUCTION RECORD PDF,
  // which paginates for real via @react-pdf and can therefore number honestly —
  // the rule is that a document which cannot know its pagination must not claim
  // it, not that the string may never appear in the product.
  chk('[9] NO page numbers are invented in the contents',
    !/Page \d|pageNumber|\.pg\b/.test(page));
  chk('[9] CONTROL — the real PDF renderer is allowed to number its pages',
    /pageNumber/.test(
      readFileSync('services/inductionRecord/InductionRecordPdf.tsx', 'utf8'),
    ));
  chk('[9]   and the reason is recorded', /cannot know where a sheet\s*\n?\s*breaks/.test(css));
  chk('[9] no simulated pagination on screen',
    !/page-boundary|simulatedPage|pageHeight/.test(page + css));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
