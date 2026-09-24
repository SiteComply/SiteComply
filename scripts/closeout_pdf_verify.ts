/**
 * The close-out pack as a controlled document.
 *
 * THE PROPERTIES THAT MATTER:
 *  - the pack a CLIENT receives is a PDF, not an HTML file they print;
 *  - machine-written prose is badged every time it appears;
 *  - the internal copy, the share copy and the ZIP copy are one document;
 *  - appendix numbering is the same collector the archive uses, so "A3" means
 *    the same file in the document and in the ZIP;
 *  - the engine traps that silently drop a footer or its page numbers.
 *
 * Run: ./scripts/closeout_pdf_verify.sh   (NOT `npx tsx` — @react-pdf is ESM)
 */
import { readFileSync } from 'fs';
import {
  renderCloseOutPackPdf,
  closeOutPackFilename,
} from '../services/closeOutPdf/renderCloseOutPack';
import type { CloseOutPackPdfData } from '../services/closeOutPdf/CloseOutPackPdf';
import { longDate, shortDateTime } from '../services/pdfKit/documentKit';

let pass = 0;
const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

const base = (over: Partial<CloseOutPackPdfData> = {}): CloseOutPackPdfData => ({
  brand: { name: 'Parry ST Electrical Ltd', tagline: null, primaryColor: '#00AEEF', logo: null },
  title: 'Dorchester Road — Project Close-Out Pack',
  version: 2,
  preparedFor: 'Cannock Housing Association',
  generatedByName: 'Dee Director',
  generatedAt: new Date('2026-09-24T15:10:00Z'),
  site: { name: 'Dorchester Road', jobReference: 'DR-2026-014', address: '72 Dorchester Road, Cannock' },
  executiveSummary: 'Forty-one operatives were inducted and nine permits issued.',
  sections: [
    { id: 'overview', label: 'Project overview',
      facts: [{ label: 'Client', value: 'Cannock Housing Association' }],
      narrative: 'The works ran for eleven weeks.' },
    { id: 'permits', label: 'Permits to work',
      rows: [[{ label: 'Reference', value: 'HW-1' }, { label: 'Status', value: 'Closed' }]] },
    { id: 'empty', label: 'Temporary works' },
  ],
  appendices: [{ ref: 'A1', title: 'Electrical certificate', source: 'Documents' }],
  appendicesIncluded: true,
  ...over,
});

async function main() {
  console.log('== CLOSE-OUT PACK — A DOCUMENT, NOT A WEB PAGE ==\n');

  console.log('[1] The archive carries a PDF');
  const archive = read('services/closeOut/closeOutArchive.ts');
  ok('the pack in the ZIP is close-out-pack.pdf', /name: 'close-out-pack\.pdf'/.test(archive));
  ok('  and the HTML pack is gone entirely',
    !/close-out-pack\.html/.test(archive) && !/function packHtml/.test(archive));
  ok('  rendered by the shared renderer', /renderCloseOutPackPdf/.test(archive));
  ok('the manifest still lists every original file', /manifest\.csv/.test(archive));

  console.log('\n[2] Nobody is asked to print a web page any more');
  const internal = read('app/platform/dashboard/sites/[id]/close-out/[packId]/page.tsx');
  const share = read('app/pack/[token]/page.tsx');
  ok('the internal pack page offers the document',
    !/PrintButton/.test(internal) && /close-out\/\$\{params\.packId\}\/pdf/.test(internal));
  ok('the client share page offers the document',
    !/PrintButton/.test(share) && /api\/pack\/\$\{params\.token\}\/pdf/.test(share));
  const printButton = read('components/worker/PrintButton.tsx');
  ok('browser printing survives only as the CPP draft convenience',
    /ONE USE LEFT/.test(printButton));

  console.log('\n[3] One pack, one document');
  const internalRoute = read('app/api/platform/sites/[id]/close-out/[packId]/pdf/route.ts');
  const shareRoute = read('app/api/pack/[token]/pdf/route.ts');
  ok('both routes render through the same renderer',
    [internalRoute, shareRoute].every((r) => /renderCloseOutPackPdf/.test(r)));
  ok('  and build their data through the same adapter',
    [internalRoute, shareRoute].every((r) => /packPdfData/.test(r)));
  ok('  and re-render from LIVE records, so access cannot be outlived',
    [internalRoute, shareRoute].every((r) => /renderPack\(/.test(r)));
  ok('the share route resolves the token and renders as the SHARER',
    /resolveShare\(params\.token\)/.test(shareRoute) && /renderPack\(share\.viewer/.test(shareRoute));
  ok('the internal route refuses a pack from another project',
    /pack\.siteId !== params\.id/.test(internalRoute));
  ok('neither copy may be cached',
    [internalRoute, shareRoute].every((r) => /'Cache-Control': 'private, no-store'/.test(r)));
  ok('appendix numbering comes from the archive\'s own collector',
    /collectAppendixLabels/.test(internalRoute) && /collectAppendixLabels/.test(shareRoute) &&
      /collectAppendices\(viewer, siteId\)/.test(archive));

  console.log('\n[4] Machine-written prose is labelled wherever it appears');
  const doc = read('services/closeOutPdf/CloseOutPackPdf.tsx');
  ok('every narrative carries the badge', /aiBadge/.test(doc) && /AI-GENERATED/.test(doc));
  ok('the full disclaimer appears where the prose begins',
    /AI_DISCLAIMER/.test(doc) && /full \/>/.test(doc));
  ok('  and a short note on every later one, so it is never unlabelled',
    /AI_NOTE_SHORT/.test(doc) && /Not an assessment of compliance/.test(doc));
  const adapter = read('services/closeOutPdf/closeOutPackPdfData.ts');
  ok('the stored narrative is re-validated against the sections that exist',
    /readStoredNarrative\(/.test(adapter));

  console.log('\n[5] It renders');
  const pdf = await renderCloseOutPackPdf(base());
  ok('the bytes are a PDF', pdf.subarray(0, 5).toString('ascii') === '%PDF-');
  ok('  with embedded faces', /FontFile/.test(pdf.toString('latin1')));
  console.log(`       (no-logo pack: ${pdf.length} bytes)`);
  // Sized WITHOUT a logo: the fixture has none, and embedding the brand mark is
  // most of the weight of a real pack. The floor only has to prove a document
  // was produced rather than an empty shell.
  ok('  and it is a document, not an empty shell', pdf.length > 8_000, pdf.length);
  const noAi = await renderCloseOutPackPdf(base({ executiveSummary: null, sections: [
    { id: 'overview', label: 'Project overview', facts: [{ label: 'Client', value: 'X' }] },
  ] }));
  ok('a pack with no AI narrative renders too', noAi.length > 8_000, noAi.length);
  const noAppendices = await renderCloseOutPackPdf(base({ appendices: [] }));
  ok('  as does one with no appendices', noAppendices.length > 8_000, noAppendices.length);
  ok('the filename says what it is',
    closeOutPackFilename(base()) === 'Close-Out-Pack-Dorchester-Road-v2.pdf',
    closeOutPackFilename(base()));

  console.log('\n[6] The kit closes the traps once, for every document');
  const kit = read('services/pdfKit/documentKit.tsx');
  ok('no lineHeight on the page style', !/pageStyle[\s\S]{0,400}lineHeight:\s*[\d.]/.test(kit));
  ok('  nor on the footer text', !/footerText: \{[^}]*lineHeight:\s*[\d.]/.test(kit));
  ok('the footer is pushed down, never positioned absolutely',
    /marginTop: 'auto'/.test(kit) && !/footer: \{[\s\S]{0,200}position: 'absolute'/.test(kit));
  ok('the page number has an explicit width', /footerRight: \{ width: \d+/.test(kit));
  ok('  and is a direct child of the fixed footer',
    /<View style=\{s\.footer\} fixed>[\s\S]{0,400}render=\{\(\{ pageNumber, totalPages \}\)/.test(kit));
  ok('only WOFF faces are registered', /\.woff'/.test(kit) && !/\.woff2/.test(kit));
  ok('hyphenation is off', /registerHyphenationCallback/.test(kit));
  ok('dates are Europe/London, not UTC',
    longDate(new Date('2026-09-24T23:30:00Z')) === '25 September 2026',
    longDate(new Date('2026-09-24T23:30:00Z')));
  ok('  and the short form is British order',
    shortDateTime(new Date('2026-01-15T09:05:00Z')) === '15/01/2026 09:05');

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
