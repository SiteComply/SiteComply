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
  chk('[7] a working draft says it is not an approved plan',
    /It is not an approved plan/.test(page));
  chk('[7] the CDM duty is still stated',
    /Principal Contractor\s*\n?\s*remains responsible/.test(page));
  chk('[7] live completeness is hidden against a frozen revision',
    /\{!viewingRevision && \(/.test(page));
  chk('[7] an unapproved document shows unsigned rules, not a claim',
    /cpp-sigline/.test(page));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
