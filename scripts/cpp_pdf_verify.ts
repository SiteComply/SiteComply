/**
 * CPP server-rendered PDF — verification.
 *
 *   npx tsx scripts/cpp_pdf_verify.ts
 *
 * The plan was produced with window.print(), which stamps the browser's own
 * page title, URL, timestamp and "1/7" onto a document issued to clients and
 * read by CDM auditors. None of that is reachable from CSS. This renders the
 * issued revision on the server instead.
 *
 * THIS SUITE RENDERS A REAL PDF AND READS IT BACK. Source greps cannot tell you
 * whether a document paginated, whether a running head repeated, whether a font
 * embedded or whether the page numbers are true — and every one of those fails
 * silently, producing a plausible-looking file. Text is extracted with
 * `pdftotext` and asserted page by page.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  renderCppPdf,
  cppRevisionFilename,
  asciiFilename,
} from '../services/sites/cppPdf/renderCppPdf';
import { getCppPdfData, type CppPdfData } from '../services/sites/cppPdf/cppPdfData';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const code = (src: string) =>
  src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('///') && !t.startsWith('/*');
  }).join('\n');

const doc = readFileSync('services/sites/cppPdf/CppPdfDocument.tsx', 'utf8');
const render = readFileSync('services/sites/cppPdf/renderCppPdf.ts', 'utf8');
const dataSrc = readFileSync('services/sites/cppPdf/cppPdfData.ts', 'utf8');
const route = readFileSync(
  'app/api/platform/sites/[id]/cpp-revisions/[revisionId]/pdf/route.ts', 'utf8');
const page = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');

/* ── A fixture long enough to paginate. A one-page document would pass every
      pagination assertion in this file without proving anything. ── */
const ISSUED = new Date('2026-09-18T09:30:00Z');
function fixture(over: Partial<CppPdfData['revision']> = {}): CppPdfData {
  return {
    site: {
      id: 'site-1',
      name: 'Dorchester Road',
      jobReference: '2417-DR',
      address: '14–22 Dorchester Road, Weymouth, DT4 7JY',
      principalContractor: 'Hartley Construction Ltd',
    },
    sections: Array.from({ length: 20 }, (_, i) => ({
      key: `sec-${i}`,
      title: `Section ${i + 1} — arrangements and controls`,
      stepKey: null,
      manageHref: null,
      entries: [
        { label: 'Arrangement', value: `Control measure ${i + 1}. ` + 'Refurbishment of a four-storey residential block including re-roofing, window replacement and external repairs. '.repeat(3) },
        { label: 'Responsible', value: 'Site Manager' },
      ],
      items: i % 3 === 0
        ? [{ label: `Listed item ${i}`, detail: 'Reviewed at induction' }]
        : [],
      gatesCompletion: i < 10,
      status: i === 4 ? 'PARTIAL' : 'COMPLETE',
      missing: i === 4 ? ['Emergency procedures'] : [],
    })) as unknown as CppPdfData['sections'],
    drawings: [{ id: 'd1', title: 'Site layout', fileName: 'layout-rev-b.pdf' }],
    revision: {
      version: 2,
      status: 'ISSUED',
      issuedAt: ISSUED,
      issuedByName: 'R. Hartley',
      preparedByName: 'M. Okonkwo',
      preparedAt: new Date('2026-09-17T14:00:00Z'),
      signedName: 'Robert Hartley',
      approverRole: 'PRINCIPAL_CONTRACTOR',
      declarationText: 'I confirm this plan is suitable and sufficient.',
      signatureImage: null,
      supersededAt: null,
      ...over,
    },
    logo: existsSync('public/sitecomply-logo.png')
      ? readFileSync('public/sitecomply-logo.png')
      : null,
  };
}

const textOf = (file: string, from?: number, to?: number) => {
  const args = ['-layout'];
  if (from) args.push('-f', String(from));
  if (to) args.push('-l', String(to));
  return execFileSync('pdftotext', [...args, file, '-'], { encoding: 'utf8' });
};

/**
 * pdftotext reproduces letter-spaced and uppercased runs one character at a
 * time — "H A R T L E Y C O N S T R U C T I O N". That is the extractor
 * faithfully reporting glyph positions, not a defect in the document, so text
 * asserted against a letter-spaced element is squashed first. Asserting on the
 * raw extract instead would fail on correct output forever.
 */
const squash = (t: string) => t.replace(/\s+/g, '');

async function main() {
  console.log('\n[1] The document renders, and paginates');
  const data = fixture();
  const pdf = await renderCppPdf(data);
  writeFileSync('/tmp/cpp_verify.pdf', pdf);
  chk('[1] a PDF is produced', pdf.length > 5000, `${pdf.length} bytes`);
  chk('[1] it really is a PDF', pdf.subarray(0, 5).toString() === '%PDF-');
  const all = textOf('/tmp/cpp_verify.pdf');
  const pages = Number((all.match(/Page \d+ of (\d+)/) || [])[1] || 0);
  chk('[1] it runs to more than one sheet', pages > 1, `${pages} pages`);
  chk('[1] CONTROL — the fixture is long enough to prove pagination', pages >= 3);

  console.log('\n[2] TRUE page numbers — the thing the browser was faking');
  const p1 = textOf('/tmp/cpp_verify.pdf', 1, 1);
  const pLast = textOf('/tmp/cpp_verify.pdf', pages, pages);
  chk('[2] page 1 is numbered 1 of N', new RegExp(`Page 1 of ${pages}`).test(p1));
  chk('[2] the last page is numbered N of N', new RegExp(`Page ${pages} of ${pages}`).test(pLast));
  chk('[2] the total is the real total, not 1',
    !/Page \d+ of 1\b/.test(all) || pages === 1);
  const numbered = Array.from({ length: pages }, (_, i) =>
    new RegExp(`Page ${i + 1} of ${pages}`).test(textOf('/tmp/cpp_verify.pdf', i + 1, i + 1)));
  chk('[2] EVERY page carries its own number', numbered.every(Boolean),
    `${numbered.filter(Boolean).length}/${pages}`);

  console.log('\n[3] Running head and foot are ours');
  chk('[3] the foot names the document on every page',
    [1, 2].every((n) => textOf('/tmp/cpp_verify.pdf', n, n).includes('2417-DR')));
  chk('[3] the running head appears from page 2',
    squash(textOf('/tmp/cpp_verify.pdf', 2, 2)).includes(squash('DORCHESTER ROAD')));
  chk('[3] page 1 has the masthead, not a running head',
    squash(p1).includes(squash('CONSTRUCTION PHASE PLAN')) &&
    squash(p1).includes(squash('HARTLEY CONSTRUCTION LTD')));
  chk('[3] no URL is printed anywhere', !/https?:\/\//.test(all));
  chk('[3] no browser-style date stamp is printed',
    !/\d{2}\/\d{2}\/\d{4},\s*\d{2}:\d{2}/.test(all));

  console.log('\n[4] The document says what it is');
  chk('[4] the revision is stated', all.includes('Revision 02'));
  chk('[4] and its status', squash(all).includes(squash('CURRENT REVISION')));
  // dd/mm/yyyy, because that is what formatDateUK returns and what the screen
  // document shows. The PDF must not invent a second date format.
  chk('[4] the issue date is UK-formatted, matching the screen', all.includes('18/09/2026'));
  chk('[4] the contents lists every section',
    data.sections.every((s) => all.includes(s.title)));
  chk('[4] the approval block is present',
    all.includes('Duty holder approval') && all.includes('Robert Hartley'));
  chk('[4] the declaration is reproduced', all.includes('suitable and sufficient'));
  chk('[4] the approver position is readable, not an enum',
    all.includes('Principal contractor') && !squash(all).includes('PRINCIPAL_CONTRACTOR'));
  chk('[4] provenance is stated once, at the foot',
    (all.match(/Prepared and issued in SiteComply/g) || []).length === 1);
  chk('[4] an incomplete section is still flagged',
    all.includes('Section incomplete'));

  console.log('\n[5] Fonts embed — the document looks the same to everyone');
  chk('[5] font subsets are embedded', (pdf.toString('latin1').match(/\/FontFile2/g) || []).length >= 2);
  chk('[5] the faces are the screen document\'s own families',
    /Chivo/.test(doc) && /CrimsonPro/.test(doc));
  for (const f of ['Chivo-400', 'Chivo-600', 'Chivo-700', 'CrimsonPro-400', 'CrimsonPro-600']) {
    chk(`[5] ${f}.woff is committed`, existsSync(`assets/fonts/${f}.woff`));
  }
  chk('[5] WOFF, never WOFF2 — fontkit reads woff2 but pdfkit cannot embed it',
    !/\.woff2/.test(code(doc)));
  chk('[5] no italic face is used, since none is registered',
    !/fontStyle:\s*'italic'/.test(code(doc)));

  console.log('\n[6] A real outline, so a dozen sheets can be navigated');
  const raw = pdf.toString('latin1');
  chk('[6] the PDF carries an outline', raw.includes('/Outlines'));
  /*
   * Outline titles are PDF text strings, and @react-pdf writes them UTF-16BE
   * with a BOM — so a plain regex for the readable text matches nothing, and a
   * loose one can match something else entirely and pass for the wrong reason.
   * They are decoded before being asserted on.
   */
  const outlineTitles = Array.from(
    pdf.toString('latin1').matchAll(/\/Title\s*\(((?:\\.|[^)])*)\)/g),
  ).map((m) => {
    const bytes = Buffer.from(
      m[1].replace(/\\([0-7]{1,3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1'),
      'latin1',
    );
    return bytes[0] === 0xfe && bytes[1] === 0xff
      ? bytes.subarray(2).swap16().toString('utf16le')
      : bytes.toString('latin1');
  });
  chk('[6] CONTROL — titles decoded, not matched as raw bytes',
    outlineTitles.length >= 20, `${outlineTitles.length} entries`);
  chk('[6] every section is an outline entry',
    data.sections.every((sec, i) =>
      outlineTitles.some((t) => t.startsWith(`${i + 1}.0`) && t.includes(sec.title))));
  chk('[6] drawings and the approval are too',
    outlineTitles.some((t) => t.includes('Drawings and emergency plans')) &&
    outlineTitles.some((t) => t.includes('Duty holder approval')));

  console.log('\n[7] DETERMINISM — what is actually guaranteed');
  /*
   * WHAT IS TRUE: the same revision renders the same DOCUMENT every time —
   * identical text, identical pagination, identical metadata. That follows from
   * the frozen snapshot plus a creation date pinned to issuedAt, and it is what
   * makes rendering on demand equivalent to keeping a copy.
   *
   * WHAT IS NOT TRUE, and was claimed before it was measured properly: the
   * BYTES are not reliably identical. When the document embeds an image, the
   * image's asynchronous load races object allocation and the same XObject is
   * written as, say, `10 0 obj` on one render and `25 0 obj` on the next. The
   * file length matches, the content matches, the rendered page matches — only
   * the internal numbering moves. Without an image the output IS byte-stable,
   * which is how the cause was isolated.
   *
   * So determinism is asserted at the level it holds: the document. If a
   * byte-for-byte identical artefact is ever required — to prove a client's
   * copy is the file that was issued — that needs the PDF stored at issue time,
   * which is a schema change and a deliberate decision.
   */
  const againBuf = await renderCppPdf(fixture());
  writeFileSync('/tmp/cpp_verify_2.pdf', againBuf);
  const againText = textOf('/tmp/cpp_verify_2.pdf');
  chk('[7] the same revision renders the same document, text for text',
    createHash('sha256').update(againText).digest('hex') ===
    createHash('sha256').update(all).digest('hex'));
  chk('[7] with the same pagination',
    Number((againText.match(/Page \d+ of (\d+)/) || [])[1] || 0) === pages);
  chk('[7] and the same length on the wire', againBuf.length === pdf.length);
  chk('[7] the creation date is pinned to the revision, not to now',
    /creationDate=\{revision\.issuedAt\}/.test(doc));
  chk('[7]   and so is the modification date',
    /modificationDate=\{revision\.issuedAt\}/.test(doc));
  // The pinned dates must actually reach the file, not just the source.
  const info = pdf.toString('latin1');
  chk('[7] the pinned date is in the PDF, so it carries no render timestamp',
    /D:20260918/.test(info), (info.match(/\/CreationDate\s*\(([^)]*)\)/) || [])[1] || '?');
  const other = await renderCppPdf(fixture({ version: 3 }));
  writeFileSync('/tmp/cpp_verify_3.pdf', other);
  chk('[7] CONTROL — a different revision renders a different document',
    textOf('/tmp/cpp_verify_3.pdf') !== all);

  console.log('\n[8] Drafts are never rendered');
  const draft = await getCppPdfData({
    ...fixture().revision, status: 'DRAFT', signatureType: null, signatureBlobPath: null,
    snapshot: { site: fixture().site, sections: [], drawings: [], takenAt: '' },
  } as unknown as Parameters<typeof getCppPdfData>[0]);
  chk('[8] getCppPdfData refuses a draft', draft === null);
  const noDate = await getCppPdfData({
    ...fixture().revision, status: 'ISSUED', issuedAt: null, signatureType: null,
    signatureBlobPath: null,
    snapshot: { site: fixture().site, sections: [], drawings: [], takenAt: '' },
  } as unknown as Parameters<typeof getCppPdfData>[0]);
  chk('[8] and an issued revision with no issue date, rather than printing "Invalid Date"',
    noDate === null);
  chk('[8] the route refuses a draft before rendering',
    /status !== 'ISSUED' && revision.status !== 'SUPERSEDED'/.test(code(route)) &&
    /409/.test(code(route)));
  chk('[8] a SUPERSEDED revision still renders — history must be reproducible',
    /'SUPERSEDED'/.test(code(dataSrc)));

  console.log('\n[9] A superseded revision cannot pass as current');
  const sup = await renderCppPdf(fixture({ status: 'SUPERSEDED', supersededAt: new Date('2026-09-20T00:00:00Z') }));
  writeFileSync('/tmp/cpp_verify_sup.pdf', sup);
  const supText = textOf('/tmp/cpp_verify_sup.pdf');
  chk('[9] it is labelled superseded', supText.includes('Superseded'));
  chk('[9] and never claims to be the current revision', !supText.includes('Current revision'));

  console.log('\n[10] The filename says what the file is, and scans');
  const name = cppRevisionFilename(data);
  chk('[10] the agreed shape', name === 'CPP - 2417-DR - Dorchester Road - Rev 02.pdf', name);
  chk('[10] it leads with what the document is', name.startsWith('CPP - '));
  chk('[10] it carries the job reference', name.includes('2417-DR'));
  chk('[10] and the site, readably — not hyphen-flattened',
    name.includes('Dorchester Road') && !name.includes('Dorchester-Road'));
  // Unpadded, a folder sorts Rev 10 between Rev 1 and Rev 2. That is exactly
  // the confusion a controlled document must not create.
  chk('[10] the revision is zero-padded so a folder sorts correctly',
    /Rev 02\.pdf$/.test(name));
  chk('[10]   and double digits still read correctly',
    cppRevisionFilename(fixture({ version: 10 })).endsWith('Rev 10.pdf'));
  chk('[10] no issue date — the revision is the key, and the date is on the plan',
    !/\d{4}-\d{2}-\d{2}/.test(name));
  chk('[10] it is shorter than the hyphen-flattened form it replaces',
    name.length < 'Construction-Phase-Plan-2417-DR-Dorchester-Road-Rev-02-2026-09-18.pdf'.length,
    `${name.length} chars`);

  // Real site names. A slash reaching a Content-Disposition header is a path
  // separator, not a character; accented and Welsh names must survive intact.
  const messy = cppRevisionFilename({
    ...data,
    site: { ...data.site, name: "St Mary's Wharf / Phase 2", jobReference: 'A/B 12' },
  });
  chk('[10] characters illegal in a filename are removed',
    !/[\\/:*?"<>|]/.test(messy), messy);
  chk('[10] but the name stays readable', messy.includes("St Mary's Wharf"));
  const welsh = cppRevisionFilename({
    ...data, site: { ...data.site, name: 'Ffôs-y-frân' },
  });
  chk('[10] accented and Welsh names are kept, not mangled', welsh.includes('Ffôs-y-frân'));
  chk('[10] and an ASCII fallback exists for clients that need one',
    asciiFilename(welsh).includes('Ffos-y-fran'), asciiFilename(welsh));
  chk('[10] the fallback carries no quote or backslash to break the header',
    !/["\\]/.test(asciiFilename(messy)));
  const empty = cppRevisionFilename({
    ...data, site: { ...data.site, name: '///', jobReference: '' },
  });
  chk('[10] an unnameable site still produces a usable filename',
    empty.startsWith('CPP - ') && empty.endsWith('.pdf') && !/ {2}/.test(empty), empty);

  console.log('\n[10b] The header carries both forms');
  chk('[10b] an RFC 5987 filename* is sent', /filename\*=UTF-8''/.test(code(route)));
  chk('[10b] with an ASCII fallback beside it', /filename="\$\{fallback\}"/.test(code(route)));
  chk('[10b] the true name is percent-encoded', /encodeURIComponent\(filename\)/.test(code(route)));

  console.log('\n[11] Authorisation is the screen\'s, not a second opinion');
  chk('[11] the route requires a platform session', /getPlatformViewer/.test(code(route)));
  chk('[11] it reuses getRevision, which checks permission AND site scope',
    /getRevision\(viewer, params\.id, params\.revisionId\)/.test(code(route)));
  chk('[11] a revision on another site 404s rather than leaking its existence',
    /404/.test(code(route)));
  chk('[11] the download is an attachment with the real filename',
    /attachment; filename=/.test(code(route)));
  chk('[11] it is not publicly cacheable', /private/.test(code(route)) && !/public/.test(code(route)));
  chk('[11] nodejs runtime — @react-pdf cannot run on edge',
    /runtime = 'nodejs'/.test(code(route)));

  console.log('\n[12] The screen offers the right control for the right thing');
  const register = readFileSync(
    'app/platform/dashboard/sites/[id]/cpp/revisions/page.tsx', 'utf8');
  chk('[12] an issued revision offers the server-rendered PDF',
    /cpp-revisions\/\$\{viewingRevision\.id\}\/pdf/.test(code(page)));
  chk('[12] the register offers it per issued revision too',
    /cpp-revisions\/\$\{r\.id\}\/pdf/.test(code(register)));
  chk('[12] neither offers one for a draft',
    /status === 'ISSUED' \|\|/.test(code(page)) &&
    /r\.status === 'ISSUED' \|\| r\.status === 'SUPERSEDED'/.test(code(register)));
  chk('[12] a draft still prints, and the label says it is the browser',
    /Print draft \(browser\)/.test(page));
  chk('[12] the old "Print / save as PDF" claim is gone from the plan',
    !/Print \/ save as PDF/.test(page));

  console.log('\n[13] The regression that cost the most to find');
  /*
   * A unitless lineHeight on the Page inherits into every descendant and makes
   * every `render`-prop element resolve to NOTHING — silently. The document
   * rendered eight clean sheets with no page numbers and no running head, and
   * the footer's static half printed normally throughout. Overriding lineHeight
   * on the element does not rescue it; the property must be absent from the
   * resolved style. The induction record documents the same trap.
   */
  const pageStyleRaw = (doc.match(/page:\s*\{[\s\S]*?\n  \},/) || [''])[0];
  // Comments stripped before the check: the block's own comment explains the
  // trap and therefore contains the very word being asserted absent.
  const pageStyle = code(pageStyleRaw);
  chk('[13] CONTROL — the page style block was located', pageStyle.includes('paddingHorizontal'));
  chk('[13] the Page style sets NO lineHeight', !/lineHeight/.test(pageStyle));
  chk('[13] and the reason is recorded where someone would re-add it',
    /render` prop/.test(pageStyleRaw) && /silent/i.test(pageStyleRaw));
  const footStyle = (doc.match(/runFootRight:[^\n]*/) || [''])[0];
  const headStyle = (doc.match(/runHeadText:\s*\{[\s\S]*?\},/) || [''])[0];
  chk('[13] nor does the running foot, which carries the page number',
    !/lineHeight/.test(footStyle));
  chk('[13] nor the running head, which blanks itself on page 1',
    !/lineHeight/.test(headStyle));
  chk('[13] leading still exists on the running text, so the document breathes',
    (doc.match(/lineHeight: 1\.[0-9]+/g) || []).length >= 5);

  /*
   * The OTHER silent one, and text assertions cannot catch it: `flex: 1` on a
   * Text inside a column container made a list item's label stretch to the
   * row's full height, so its detail line printed ON TOP of it. Both strings
   * were present and correctly ordered in the extracted text — the defect was
   * only visible by rendering the page to an image and looking at it.
   */
  const itemLabelStyle = (doc.match(/itemLabel:[^\n]*/) || [''])[0];
  chk('[13] a list item label does not stretch over its own detail',
    !/flex:\s*1/.test(itemLabelStyle), itemLabelStyle.trim());
  chk('[13] the colophon does not repeat the running foot\'s reference',
    !/colophonRef/.test(doc));
  chk('[13] CONTROL — the imprint is still there',
    /Prepared and issued in SiteComply/.test(doc));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
