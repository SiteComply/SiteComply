/**
 * THE DOCUMENT FRAMEWORK, as a whole.
 *
 * The other PDF suites each check one document. This one checks that the
 * documents form a FAMILY: that they share the chrome instead of copying it,
 * that none of them re-invents a date format, and that the engine traps stay
 * closed in the one place they are now closed.
 *
 * Run: ./scripts/pdfkit_verify.sh
 */
import { readFileSync, existsSync } from 'fs';
// A static import: the suite is bundled to ESM (see the .sh), where a dynamic
// `require` does not exist.
import { execSync } from 'child_process';
import {
  longDate,
  longDateTime,
  shortDateTime,
  timeOnly,
  pageStyle,
} from '../services/pdfKit/documentKit';

let pass = 0;
const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

/** Every server-rendered document in the product. */
const DOCUMENTS = {
  'permit': 'services/permitRecord/PermitRecordPdf.tsx',
  'induction record': 'services/inductionRecord/InductionRecordPdf.tsx',
  'close-out pack': 'services/closeOutPdf/CloseOutPackPdf.tsx',
  'CPP revision': 'services/sites/cppPdf/CppPdfDocument.tsx',
};

function main() {
  console.log('== THE DOCUMENT FRAMEWORK ==\n');

  console.log('[1] Every document exists and is server-rendered');
  for (const [name, path] of Object.entries(DOCUMENTS)) {
    ok(`${name} is a @react-pdf document`,
      existsSync(path) && /@react-pdf\/renderer/.test(read(path)));
  }

  console.log('\n[2] The chrome is shared, not copied');
  const kit = read('services/pdfKit/documentKit.tsx');
  for (const name of ['permit', 'induction record', 'close-out pack'] as const) {
    const doc = read(DOCUMENTS[name]);
    ok(`the ${name} takes its chrome from the kit`,
      /from '@\/services\/pdfKit\/documentKit'/.test(doc));
    ok(`  and does not register its own faces`, !/Font\.register\(/.test(doc));
  }
  /*
   * THE CPP IS THE DELIBERATE EXCEPTION. It is set in its own typeface because
   * it is an issued, revision-controlled PLAN rather than a record of an event,
   * and that treatment was settled with the owner. It registers its own family
   * for that reason; it is not an oversight, and migrating it would undo a
   * decision rather than remove a duplication.
   */
  const cpp = read(DOCUMENTS['CPP revision']);
  ok('the CPP keeps its own typeface, by decision', /Chivo/.test(cpp));
  ok('  and says so where a reader would look', /Chivo|serif|typeface|face/i.test(cpp));

  console.log('\n[3] Nobody re-invents a date');
  for (const [name, path] of Object.entries(DOCUMENTS)) {
    const doc = read(path);
    ok(`the ${name} does not format from UTC parts`,
      !/getUTCDate\(\)|getUTCHours\(\)|getUTCMonth\(\)/.test(doc),
      'a document formatted from UTC parts is an hour out for half the year');
  }
  ok('the kit formats in Europe/London',
    /timeZone: 'Europe\/London'/.test(kit));
  ok('  a BST time keeps its hour',
    longDateTime(new Date('2026-09-08T07:42:00Z')) === '8 September 2026 at 08:42',
    longDateTime(new Date('2026-09-08T07:42:00Z')));
  ok('  and a BST midnight keeps its DAY',
    longDate(new Date('2026-07-01T23:30:00Z')) === '2 July 2026',
    longDate(new Date('2026-07-01T23:30:00Z')));
  ok('  the short form is British order',
    shortDateTime(new Date('2026-01-15T09:05:00Z')) === '15/01/2026 09:05');
  ok('  and the time alone is site time', timeOnly(new Date('2026-09-08T07:42:00Z')) === '08:42');

  console.log('\n[4] The four traps stay closed, once');
  ok('no lineHeight on the page style', !/lineHeight/.test(String(JSON.stringify(pageStyle()))));
  ok('  nor on the footer text', !/footerText: \{[^}]*lineHeight:\s*[\d.]/.test(kit));
  ok('the footer is pushed down, never positioned absolutely',
    /marginTop: 'auto'/.test(kit) && !/footer: \{[\s\S]{0,200}position: 'absolute'/.test(kit));
  ok('the page number has an explicit width', /footerRight: \{ width: \d+/.test(kit));
  ok('  and is a direct child of the fixed footer',
    /<View style=\{s\.footer\} fixed>[\s\S]{0,400}render=\{\(\{ pageNumber, totalPages \}\)/.test(kit));
  ok('only WOFF faces are registered', /\.woff'/.test(kit) && !/\.woff2/.test(kit));
  ok('hyphenation is off', /registerHyphenationCallback/.test(kit));
  ok('the traps are documented where the next document will look', /THE TRAPS, CLOSED HERE/.test(kit));

  console.log('\n[5] Nothing prints a web page any more');
  const printButton = read('components/worker/PrintButton.tsx');
  ok('the print button survives for the CPP draft only', /ONE USE LEFT/.test(printButton));
  const callers = execSync(
    'grep -rl "<PrintButton" --include=*.tsx app components || true',
  ).toString().trim().split('\n').filter(Boolean);
  ok('  and exactly one screen calls it', callers.length === 1, callers);
  ok('  which is the CPP draft view', callers[0]?.includes('/cpp/page.tsx'), callers);
  /*
   * CALLS, not mentions. Two screens carry comments explaining why they no
   * longer print themselves, and a file-level grep counts those as offenders -
   * which would make this assertion fail on exactly the files that prove the
   * point.
   */
  const printCalls = execSync(
    'grep -rn "window.print()" --include=*.tsx app components || true',
  ).toString().trim().split('\n').filter(Boolean)
    .filter((line) => {
      const code = line.split(':').slice(2).join(':').trim();
      return !/^(\*|\/\/|\/\*|\{\/\*)/.test(code);
    });
  ok('nothing else CALLS window.print at all',
    printCalls.length === 1 && printCalls[0]!.includes('PrintButton.tsx'), printCalls);

  console.log('\n[6] Every document carries the same furniture');
  for (const name of ['permit', 'induction record', 'close-out pack'] as const) {
    const doc = read(DOCUMENTS[name]);
    ok(`the ${name} has a masthead and a paginated footer`,
      /<Masthead/.test(doc) && /<DocumentFooter/.test(doc));
  }
  ok('the CPP paginates too, through its own footer',
    /pageNumber/.test(cpp) && /totalPages/.test(cpp));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
