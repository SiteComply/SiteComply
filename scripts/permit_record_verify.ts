/**
 * The permit as a controlled document.
 *
 * THE PROPERTIES THAT MATTER:
 *  - the document never flatters the permit: expired, refused and cancelled
 *    permits do not read as authorisations;
 *  - the state is derived AS AT generation, by the same rule the screens use;
 *  - the times are site times, not UTC;
 *  - it is a real PDF with embedded fonts and working page numbers — the two
 *    traps that produce a plausible document with no pagination;
 *  - the operative's copy and the manager's copy are the same document.
 *
 * Run: ./scripts/permit_record_verify.sh   (NOT `npx tsx` — see the wrapper)
 */
import { readFileSync } from 'fs';
import {
  formatAnswer,
  permitRecordFilename,
  type PermitRecordData,
} from '../services/permitRecord/permitRecordData';
// The dates come from the shared kit now; the assertions follow the property.
import { longDateTime, shortDateTime } from '../services/pdfKit/documentKit';
import { renderPermitRecordPdf } from '../services/permitRecord/renderPermitRecord';

let pass = 0;
const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

const base = (over: Partial<PermitRecordData> = {}): PermitRecordData => ({
  reference: 'HW-260924-004',
  generatedAt: new Date('2026-09-24T14:35:00Z'),
  company: { name: 'Parry ST Electrical Ltd', tagline: null, primaryColor: '#00AEEF', logo: null },
  status: { value: 'APPROVED', label: 'Approved', authorised: true,
    statement: 'This work is authorised until the time shown below.' },
  work: {
    permitTypeName: 'Hot Works',
    activity: 'Soldering copper pipework on the second floor.',
    location: 'Second floor, east riser',
    proposedStart: new Date('2026-09-24T08:00:00Z'),
    proposedFinish: new Date('2026-09-24T16:00:00Z'),
  },
  validity: { from: new Date('2026-09-24T08:00:00Z'), until: new Date('2026-09-24T16:00:00Z') },
  operative: { name: 'Ryan Schubert', company: 'Caledonian Groundworks Ltd' },
  site: { name: 'Dorchester Road', jobReference: 'DR-2026-014',
    address: ['72 Dorchester Road', 'Cannock'], principalContractor: 'RS Electrical Ltd' },
  conditions: [
    { label: 'Area cleared of combustibles?', value: 'Yes', negative: false },
    { label: 'Fire alarm isolated in this zone?', value: 'No', negative: true },
  ],
  authorisation: {
    submittedBy: 'Ryan Schubert', submittedAt: new Date('2026-09-23T16:12:00Z'),
    reviewedBy: null, reviewedAt: null,
    approvedBy: 'Dee Director', approvedAt: new Date('2026-09-23T17:40:00Z'),
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    cancelledAt: null, closedBy: null, closedAt: null,
  },
  history: [{ at: new Date('2026-09-23T16:12:00Z'), what: 'Requested', who: 'Ryan Schubert', note: null }],
  ...over,
});

async function main() {
  console.log('== PERMIT RECORD — A CONTROLLED DOCUMENT ==\n');

  console.log('[1] Answers are words, and a "no" is visible');
  ok('a true boolean reads as Yes', formatAnswer({ questionId: 'q', label: 'L', type: 'YES_NO', value: true } as never).value === 'Yes');
  ok('a false boolean reads as No, and is marked negative',
    formatAnswer({ questionId: 'q', label: 'L', type: 'YES_NO', value: false } as never).negative === true);
  ok('a typed "no" is marked negative too',
    formatAnswer({ questionId: 'q', label: 'L', type: 'TEXT', value: 'No' } as never).negative === true);
  ok('an empty answer says so rather than leaving a blank on a permit',
    formatAnswer({ questionId: 'q', label: 'L', type: 'TEXT', value: '' } as never).value === 'Not answered');
  ok('free text is carried through unchanged',
    formatAnswer({ questionId: 'q', label: 'L', type: 'TEXT', value: 'M. Marshal, 60 mins' } as never).value === 'M. Marshal, 60 mins');

  console.log('\n[2] Site time, not UTC');
  // 16:00 UTC in September is 17:00 in London. A permit an hour out on its
  // expiry is the failure this guards.
  ok('a BST time prints as the site sees it',
    longDateTime(new Date('2026-09-24T16:00:00Z')) === '24 September 2026 at 17:00',
    longDateTime(new Date('2026-09-24T16:00:00Z')));
  ok('  and a GMT time is not shifted',
    longDateTime(new Date('2026-01-15T09:30:00Z')) === '15 January 2026 at 09:30',
    longDateTime(new Date('2026-01-15T09:30:00Z')));
  ok('the short form is British order',
    shortDateTime(new Date('2026-09-24T16:00:00Z')) === '24/09/2026 17:00');

  console.log('\n[3] The filename says what the document is');
  ok('reference and site, unopened', permitRecordFilename(base()) === 'Permit-HW-260924-004-Dorchester-Road.pdf',
    permitRecordFilename(base()));

  console.log('\n[4] It renders as a real PDF');
  const pdf = await renderPermitRecordPdf(base());
  ok('the bytes are a PDF', pdf.subarray(0, 5).toString('ascii') === '%PDF-', pdf.subarray(0, 8).toString('ascii'));
  ok('  of a sensible size', pdf.length > 20_000, pdf.length);
  const text = pdf.toString('latin1');
  ok('  the fonts are EMBEDDED, so it looks the same to everyone',
    /FontFile2|FontFile3|FontFile/.test(text));
  ok('  and it declares itself', /SiteComply/.test(text));

  console.log('\n[5] The document does not flatter the permit');
  const expired = await renderPermitRecordPdf(base({
    status: { value: 'EXPIRED', label: 'Expired', authorised: false,
      statement: 'This permit has expired. The work it authorised may NOT continue under it.' },
  }));
  ok('an expired permit renders', expired.length > 20_000);
  ok('  and is a different document from the approved one', !expired.equals(pdf));
  const refused = await renderPermitRecordPdf(base({
    status: { value: 'REJECTED', label: 'Rejected', authorised: false,
      statement: 'This permit was refused. The work it describes is NOT authorised.' },
    authorisation: { ...base().authorisation, approvedBy: null, approvedAt: null,
      rejectedBy: 'Dee Director', rejectedAt: new Date('2026-09-23T18:00:00Z'),
      rejectionReason: 'Fire watch cover not confirmed.' },
  }));
  ok('a refused permit renders, with its reason', refused.length > 20_000);

  console.log('\n[6] The traps, now closed once in the shared kit');
  const doc = read('services/permitRecord/PermitRecordPdf.tsx');
  const kit = read('services/pdfKit/documentKit.tsx');
  ok('the permit takes its chrome from the kit rather than copying it',
    /from '@\/services\/pdfKit\/documentKit'/.test(doc) &&
      /<Masthead/.test(doc) && /<DocumentFooter/.test(doc));
  ok('  and no longer registers its own faces',
    !/Font\.register/.test(doc) && !/FONT_DIR/.test(doc));
  ok('no lineHeight on the page style — it silently kills every render prop',
    !/pageStyle[\s\S]{0,400}lineHeight:\s*[\d.]/.test(kit));
  ok('  nor on the footer text, which kills the page number the same way',
    !/footerText: \{[^}]*lineHeight:\s*[\d.]/.test(kit));
  ok('the footer is pushed down by marginTop, not positioned absolutely',
    /marginTop: 'auto'/.test(kit) && !/footer: \{[\s\S]{0,200}position: 'absolute'/.test(kit));
  ok('the page-number Text has an explicit width, or it collapses to nothing',
    /footerRight: \{ width: \d+/.test(kit));
  ok('the page number is a DIRECT child of the fixed footer',
    /<View style=\{s\.footer\} fixed>[\s\S]{0,400}render=\{\(\{ pageNumber, totalPages \}\)/.test(kit));
  ok('WOFF faces, not WOFF2 — WOFF2 reads fine and cannot be embedded',
    /\.woff'/.test(kit) && !/\.woff2/.test(kit));
  ok('hyphenation is off, so a reference is never broken across a line',
    /registerHyphenationCallback/.test(kit));

  console.log('\n[7] One permit, one document');
  const workerRoute = read('app/api/worker/permits/[id]/record/route.ts');
  const platformRoute = read('app/api/platform/permits/[id]/record/route.ts');
  ok('both copies come from the same renderer',
    /renderPermitRecordPdf/.test(workerRoute) && /renderPermitRecordPdf/.test(platformRoute));
  ok('  and the same data loader', 
    /loadPermitRecord/.test(workerRoute) && /loadPermitRecord/.test(platformRoute));
  ok('the operative may only open THEIR OWN permit',
    /getWorkerPermit\(context\.worker\.id, params\.id\)/.test(workerRoute));
  ok('the manager is scoped to their assigned sites and the permits module',
    /assertModuleView\(viewer, 'permits'\)/.test(platformRoute) && /getPermitForViewer/.test(platformRoute));
  ok('neither copy may be cached — a permit expires',
    [workerRoute, platformRoute].every((r) => /'Cache-Control': 'private, no-store'/.test(r)));

  console.log('\n[8] The screen no longer prints itself');
  const actions = read('components/permits/PermitActions.tsx');
  ok('the worker gets the document, not the browser print dialog',
    !/window\.print/.test(actions) && /api\/worker\/permits\/\$\{permitId\}\/record/.test(actions));
  const platformPage = read('app/platform/dashboard/permits/[id]/page.tsx');
  ok('and the manager has a copy at all, which they did not before',
    /api\/platform\/permits\/\$\{permit\.id\}\/record/.test(platformPage));

  const data = read('services/permitRecord/permitRecordData.ts');
  ok('the state is derived as at generation, by the rule the screens use',
    /effectiveStatus\(\{/.test(data));
  ok('  and the document is stamped with when that was',
    /Status shown as at/.test(read('services/permitRecord/PermitRecordPdf.tsx')));
  ok('the permit keeps its own reference — no second number for one permit',
    /reference: permit\.reference/.test(data));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
