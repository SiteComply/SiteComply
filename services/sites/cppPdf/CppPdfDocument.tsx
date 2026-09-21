import path from 'path';
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  Font,
  StyleSheet,
} from '@react-pdf/renderer';
import { formatDateUK } from '@/lib/datetime';
import type { CppPdfData } from '@/services/sites/cppPdf/cppPdfData';

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

let fontsRegistered = false;

/**
 * Chivo and Crimson Pro — the same two families the screen document loads
 * through next/font, so the controlled PDF and the on-screen plan share one
 * type identity.
 *
 * WOFF, not WOFF2. fontkit READS woff2 perfectly well, which makes a woff2 file
 * look correct right up to the moment the document is written; it is pdfkit
 * that cannot EMBED it, and it fails deep inside EmbeddedFont.embed with a
 * stack trace that never mentions woff2. See assets/fonts/README.md.
 *
 * NO ITALIC FACE IS REGISTERED for either family, and nothing here is set in
 * italic. @react-pdf resolves by (family, weight, style) and THROWS on a missing
 * combination rather than synthesising an oblique — so setting any text in this
 * document to italic without first adding the face would 500 every plan.
 */
export function registerFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: 'Chivo',
    fonts: [
      { src: path.join(FONT_DIR, 'Chivo-400.woff'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'Chivo-600.woff'), fontWeight: 600 },
      { src: path.join(FONT_DIR, 'Chivo-700.woff'), fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'CrimsonPro',
    fonts: [
      { src: path.join(FONT_DIR, 'CrimsonPro-400.woff'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'CrimsonPro-600.woff'), fontWeight: 600 },
    ],
  });
  // Site names, addresses and operative names must never be hyphenated
  // mid-word: a broken proper noun in a controlled document reads as a typo.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

/** The screen document's palette, literal — see .cpp-doc in globals.css. */
const INK = '#16181a';
const INK_2 = '#3d4145';
const INK_3 = '#71767c';
const RULE = '#c4c6c8';
const RULE_2 = '#e3e4e5';
const ACCENT = '#003a54';
const FLAG = '#7a5410';
const TINT = '#f2fafd';
const TINT_RULE = '#d7ebf4';

const s = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    color: INK,
    fontFamily: 'CrimsonPro',
    fontSize: 10.5,
    // Room at the foot for the running footer, which is what replaces the
    // browser's own. 16mm ≈ 45pt sides; the foot is deeper to clear the rule.
    paddingTop: 42,
    paddingBottom: 54,
    paddingHorizontal: 45,
    // NO `lineHeight` HERE, deliberately — the induction record hit this first
    // and documented it, and this document hit it anyway.
    //
    // A lineHeight on the Page INHERITS into every descendant, and any element
    // carrying one resolves its `render` prop to NOTHING. The failure is
    // entirely silent: eight sheets rendered, the footer's static half printed
    // on every page, and the page numbers and running head simply were not
    // there. Setting lineHeight back on the element does not rescue it, and nor
    // does a points value — the property has to be absent from the resolved
    // style. Leading therefore lives on the individual text styles below.
  },

  /* ── Running head and foot. These are the whole reason the document is
     rendered here rather than printed from a browser. ── */
  /*
   * NEITHER OF THESE IS ABSOLUTELY POSITIONED, and that is not a style
   * preference. An absolutely positioned `fixed` block renders perfectly in
   * isolation and then produces NOTHING inside a real paginated page — the
   * induction record hit this first and documented it, and this document hit it
   * again on the first render: eight sheets, no running head, no page numbers.
   *
   * The head is a normal block at the top of the flow; the foot is pushed down
   * with `marginTop: 'auto'` and carries its rule as its own border.
   */
  runHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    fontFamily: 'Chivo',
    fontSize: 7.5,
    color: INK_3,
  },
  runHeadText: {
    fontFamily: 'Chivo', fontSize: 7.5, color: INK_3,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  runFoot: {
    marginTop: 'auto',
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  runFootLeft: { flexGrow: 1, flexShrink: 1, fontFamily: 'Chivo', fontSize: 7.5, color: INK_3 },
  runFootRight: { width: 90, textAlign: 'right', fontFamily: 'Chivo', fontSize: 7.5, color: INK_3 },

  /* ── Masthead ── */
  provenance: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },
  // 22pt ≈ the 22px the screen document prints at, holding the mark below the
  // 24pt title exactly as agreed.
  provenanceMark: { height: 22, width: 49 },
  issuer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 7,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  issuerName: {
    fontFamily: 'Chivo', fontSize: 9, fontWeight: 600,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  issuerRef: {
    fontFamily: 'Chivo', fontSize: 9, fontWeight: 400,
    letterSpacing: 0.8, textTransform: 'uppercase', color: INK_3,
  },
  doctype: {
    fontFamily: 'Chivo', fontSize: 9, fontWeight: 600,
    letterSpacing: 1.8, textTransform: 'uppercase',
    color: ACCENT, marginTop: 18, marginBottom: 10,
  },
  title: { fontFamily: 'Chivo', fontSize: 24, fontWeight: 700, letterSpacing: -0.6 },
  address: { fontSize: 12.5, color: INK_2, marginTop: 7, lineHeight: 1.4 },

  status: {
    marginTop: 18, paddingVertical: 9,
    borderTopWidth: 0.7, borderBottomWidth: 0.7, borderColor: ACCENT,
    flexDirection: 'row', alignItems: 'baseline',
  },
  statusRev: { fontFamily: 'Chivo', fontSize: 14, fontWeight: 700 },
  statusState: {
    fontFamily: 'Chivo', fontSize: 8.5, fontWeight: 600, letterSpacing: 1.2,
    textTransform: 'uppercase', color: INK_2, marginLeft: 16,
  },
  statusWhen: { fontFamily: 'Chivo', fontSize: 9.5, color: INK_2, marginLeft: 'auto' },

  control: {
    marginTop: 14, paddingTop: 10, paddingBottom: 3, paddingHorizontal: 12,
    backgroundColor: TINT, borderLeftWidth: 1.5, borderLeftColor: ACCENT,
    flexDirection: 'row', flexWrap: 'wrap',
  },
  controlRow: {
    width: '50%', flexDirection: 'row', paddingVertical: 4, paddingRight: 14,
    borderBottomWidth: 0.5, borderBottomColor: TINT_RULE,
  },
  controlDt: {
    fontFamily: 'Chivo', fontSize: 7.5, fontWeight: 600, letterSpacing: 0.9,
    textTransform: 'uppercase', color: INK_3, width: 86, paddingTop: 1.5,
  },
  controlDd: { fontSize: 10, flex: 1, lineHeight: 1.35 },

  /* ── Contents ── */
  contentsTitle: {
    fontFamily: 'Chivo', fontSize: 9, fontWeight: 700, letterSpacing: 1.6,
    textTransform: 'uppercase', paddingBottom: 5,
    borderBottomWidth: 1.5, borderBottomColor: INK, marginBottom: 12,
  },
  contentsRow: { flexDirection: 'row', paddingVertical: 3.5 },
  contentsNo: { fontFamily: 'Chivo', fontSize: 9, fontWeight: 700, color: ACCENT, width: 34 },
  contentsLabel: { fontSize: 10.5, flexGrow: 1, flexShrink: 1, lineHeight: 1.4 },

  /* ── Body ── */
  part: {
    fontFamily: 'Chivo', fontSize: 9, fontWeight: 700, letterSpacing: 1.6,
    textTransform: 'uppercase', paddingBottom: 5,
    borderBottomWidth: 1.5, borderBottomColor: INK, marginBottom: 14,
  },
  section: {
    flexDirection: 'row', paddingVertical: 11,
    borderBottomWidth: 0.5, borderBottomColor: RULE_2,
  },
  sectionNo: { fontFamily: 'Chivo', fontSize: 9, fontWeight: 700, color: ACCENT, width: 34, paddingTop: 3 },
  sectionBody: { flex: 1 },
  h2: { fontFamily: 'Chivo', fontSize: 12, fontWeight: 700, marginBottom: 4 },
  origin: { fontFamily: 'Chivo', fontSize: 8, color: INK_3, marginBottom: 5 },
  label: {
    fontFamily: 'Chivo', fontSize: 7.5, fontWeight: 600, letterSpacing: 0.9,
    textTransform: 'uppercase', color: INK_3, marginBottom: 2,
  },
  para: { fontSize: 10.5, color: INK_2, marginBottom: 8, lineHeight: 1.45 },
  na: { fontSize: 10.5, color: INK_3, lineHeight: 1.45 },
  itemRow: { flexDirection: 'row', paddingVertical: 2.5 },
  itemBullet: { width: 10, fontSize: 10.5, color: INK_3 },
  /* NO `flex: 1` here. It is a row-context property, and this Text sits in a
     column: with it, the label stretched to fill the row's height and the
     detail beneath printed ON TOP of it. Visible only by looking at the page —
     every text assertion still passed, because both strings were present. */
  itemLabel: { fontSize: 10.5, lineHeight: 1.4 },
  itemDetail: { fontSize: 9.5, color: INK_3, marginTop: 1, lineHeight: 1.4 },
  flag: { fontFamily: 'Chivo', fontSize: 8.5, color: FLAG, marginTop: 5 },

  /* ── Approval ── */
  approval: { marginTop: 26, paddingTop: 12, borderTopWidth: 2, borderTopColor: INK },
  approvalTitle: { fontFamily: 'Chivo', fontSize: 13, fontWeight: 700, marginBottom: 3 },
  approvalMeta: { fontFamily: 'Chivo', fontSize: 8.5, color: INK_3, marginBottom: 12 },
  decl: { fontSize: 10.5, color: INK_2, marginBottom: 14, lineHeight: 1.45 },
  whoRow: { flexDirection: 'row', marginBottom: 16 },
  whoCell: { flex: 1, paddingRight: 14 },
  sigImage: { height: 42, width: 'auto', maxWidth: 200 },
  sigTyped: { fontFamily: 'CrimsonPro', fontSize: 17, color: INK },
  sigLine: { borderBottomWidth: 0.7, borderBottomColor: RULE, width: 200, height: 20 },
  sigCap: {
    fontFamily: 'Chivo', fontSize: 7.5, color: INK_3, marginTop: 4,
    paddingTop: 4, borderTopWidth: 0.5, borderTopColor: RULE_2, width: 200,
  },

  /* ── Colophon ── */
  /* The colophon carries the IMPRINT ONLY. It used to repeat the document
     reference, which the running foot now prints on every page — so on the last
     sheet the same line appeared twice, a few points apart. */
  colophon: {
    marginTop: 26, paddingTop: 10, marginBottom: 12,
    borderTopWidth: 0.5, borderTopColor: RULE,
    flexDirection: 'row', justifyContent: 'flex-end',
  },
  colophonMark: { height: 19, width: 42, marginBottom: 4, alignSelf: 'flex-end' },
  colophonNote: { fontFamily: 'Chivo', fontSize: 7.5, color: INK_3, textAlign: 'right' },
});

/**
 * PDF OUTLINE ENTRIES — real, clickable navigation in any reader, which matters
 * for a plan that runs to a dozen sheets.
 *
 * `bookmark` is supported by @react-pdf at runtime (it is declared on NodeProps
 * in @react-pdf/types and handled in both the layout and render bundles), but
 * the RENDERER package ships its own narrower .d.ts in which NodeProps has no
 * such prop. Rather than cast at every call site, it is applied through this one
 * helper — and verified by rendering rather than trusted: the output carries an
 * /Outlines tree with these exact titles, which cpp_pdf_verify asserts.
 */
type Bookmarked = { bookmark?: { title: string; fit?: boolean } };
const outline = (title: string): Bookmarked => ({ bookmark: { title, fit: true } });

const rev2 = (n: number) => String(n).padStart(2, '0');

const titleCase = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function CppPdfDocument({ data }: { data: CppPdfData }): React.ReactElement {
  const { site, sections, drawings, revision, logo } = data;
  const revLabel = `Revision ${rev2(revision.version)}`;
  const state = revision.status === 'ISSUED' ? 'Current revision' : 'Superseded';
  const docRef = `${site.jobReference} · Construction Phase Plan · ${revLabel}`;

  return (
    <Document
      title={`Construction Phase Plan — ${site.name} — ${revLabel}`}
      author={site.principalContractor ?? site.name}
      subject="Construction Phase Plan (CDM 2015)"
      creator="SiteComply"
      producer="SiteComply"
      /*
       * PINNED TO THE ISSUE DATE, not to now. pdfkit stamps a creation date into
       * every document, so an unpinned render produces different bytes on every
       * request. Pinned, the PDF for a given revision is BYTE-IDENTICAL however
       * many times it is generated — which is what lets this be rendered on
       * demand instead of stored, and what makes two downloads of Revision 2
       * provably the same document.
       */
      creationDate={revision.issuedAt}
      modificationDate={revision.issuedAt}
    >
      <Page size="A4" style={s.page} wrap>
        {/* RUNNING HEAD — from page 2 onward. Page 1 carries the masthead,
            which says all of this at full size, so the head blanks itself
            there rather than repeating it.

            The `render` props sit on the Text elements themselves, which are
            DIRECT children of the fixed View. One level deeper and they simply
            do not resolve — the neighbouring lines print and the dynamic one
            silently does not. */}
        <View style={s.runHead} fixed>
          <Text
            style={s.runHeadText}
            render={({ pageNumber }) => (pageNumber === 1 ? '' : site.name)}
          />
          <Text
            style={s.runHeadText}
            render={({ pageNumber }) => (pageNumber === 1 ? '' : `${revLabel} · ${state}`)}
          />
        </View>

        {/* ── MASTHEAD ── */}
        {logo && (
          <View style={s.provenance}>
            <Image style={s.provenanceMark} src={logo} />
          </View>
        )}
        <View style={s.issuer}>
          <Text style={s.issuerName}>{site.principalContractor ?? site.name}</Text>
          <Text style={s.issuerRef}>{`Job ${site.jobReference}`}</Text>
        </View>
        <Text style={s.doctype}>Construction Phase Plan — CDM 2015</Text>
        <Text style={s.title}>{site.name}</Text>
        {site.address ? <Text style={s.address}>{site.address}</Text> : null}

        <View style={s.status}>
          <Text style={s.statusRev}>{revLabel}</Text>
          <Text style={s.statusState}>{state}</Text>
          <Text style={s.statusWhen}>{`Issued ${formatDateUK(revision.issuedAt)}`}</Text>
        </View>

        <View style={s.control}>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Prepared by</Text>
            <Text style={s.controlDd}>{revision.preparedByName}</Text>
          </View>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Approved by</Text>
            <Text style={s.controlDd}>
              {revision.signedName ?? revision.issuedByName ?? 'Not recorded'}
            </Text>
          </View>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Prepared</Text>
            <Text style={s.controlDd}>{formatDateUK(revision.preparedAt)}</Text>
          </View>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Issued</Text>
            <Text style={s.controlDd}>{formatDateUK(revision.issuedAt)}</Text>
          </View>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Job reference</Text>
            <Text style={s.controlDd}>{site.jobReference}</Text>
          </View>
          <View style={s.controlRow}>
            <Text style={s.controlDt}>Status</Text>
            <Text style={s.controlDd}>
              {revision.status === 'ISSUED'
                ? 'Issued — in force'
                : `Superseded${revision.supersededAt ? ` ${formatDateUK(revision.supersededAt)}` : ''}`}
            </Text>
          </View>
        </View>

        {/* ── CONTENTS ──
            Section numbers, not page numbers. @react-pdf cannot tell an entry
            which page its section lands on in a single pass, and a contents page
            citing a page the document then contradicts is a document-control
            defect — the same rule the screen view follows. The PDF outline below
            gives a reader real, clickable navigation instead. */}
        <View style={{ marginTop: 26 }} break>
          <Text style={s.contentsTitle}>Contents</Text>
          {sections.map((sec, i) => (
            <View style={s.contentsRow} key={sec.key}>
              <Text style={s.contentsNo}>{`${i + 1}.0`}</Text>
              <Text style={s.contentsLabel}>{sec.title}</Text>
            </View>
          ))}
          <View style={s.contentsRow}>
            <Text style={s.contentsNo}>{`${sections.length + 1}.0`}</Text>
            <Text style={s.contentsLabel}>Drawings and emergency plans</Text>
          </View>
          <View style={s.contentsRow}>
            <Text style={s.contentsNo}>{`${sections.length + 2}.0`}</Text>
            <Text style={s.contentsLabel}>Duty holder approval</Text>
          </View>
        </View>

        {/* ── THE PLAN ── */}
        <View break>
          <Text style={s.part}>Construction Phase Plan</Text>
          {sections.map((sec, i) => {
            const valued = sec.entries.filter((e) => e.value !== null);
            const showOrigin = !sec.gatesCompletion && valued.length > 0;
            const entries = valued.filter(
              (e) => sec.gatesCompletion || sec.items.length > 0 || e !== sec.entries[0],
            );
            const blank = sec.items.length === 0 && valued.length === 0;
            return (
              <View style={s.section} key={sec.key} wrap={false} {...outline(`${i + 1}.0  ${sec.title}`)}>
                <Text style={s.sectionNo}>{`${i + 1}.0`}</Text>
                <View style={s.sectionBody}>
                  <Text style={s.h2}>{sec.title}</Text>
                  {showOrigin && sec.entries[0]?.value ? (
                    <Text style={s.origin}>{sec.entries[0].label}</Text>
                  ) : null}
                  {sec.items.map((it, n) => (
                    <View style={s.itemRow} key={`${n}-${it.label}`}>
                      <Text style={s.itemBullet}>·</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemLabel}>{it.label}</Text>
                        {it.detail ? <Text style={s.itemDetail}>{it.detail}</Text> : null}
                      </View>
                    </View>
                  ))}
                  {entries.map((e) => (
                    <View key={e.label} style={{ marginTop: 6 }}>
                      <Text style={s.label}>{e.label}</Text>
                      <Text style={s.para}>{e.value}</Text>
                    </View>
                  ))}
                  {blank ? (
                    <Text style={s.na}>
                      {sec.gatesCompletion ? 'Not yet recorded.' : 'None recorded.'}
                    </Text>
                  ) : null}
                  {sec.status === 'PARTIAL' && sec.missing.length > 0 ? (
                    <Text style={s.flag}>
                      {`Section incomplete. Still required: ${sec.missing.join(', ')}.`}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {/* Drawings */}
          <View style={s.section} wrap={false} {...outline(`${sections.length + 1}.0  Drawings and emergency plans`)}>
            <Text style={s.sectionNo}>{`${sections.length + 1}.0`}</Text>
            <View style={s.sectionBody}>
              <Text style={s.h2}>Drawings and emergency plans</Text>
              {drawings.length === 0 ? (
                <Text style={s.na}>
                  No site layout drawings or emergency plans are filed for this project.
                </Text>
              ) : (
                <>
                  {drawings.map((d) => (
                    <View style={s.itemRow} key={d.id}>
                      <Text style={s.itemBullet}>·</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemLabel}>{d.title}</Text>
                        <Text style={s.itemDetail}>{d.fileName}</Text>
                      </View>
                    </View>
                  ))}
                  <Text style={[s.origin, { marginTop: 6 }]}>
                    Drawings are held in the site&rsquo;s document register and issued
                    alongside this plan.
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* ── APPROVAL ── */}
        <View style={s.approval} wrap={false} {...outline(`${sections.length + 2}.0  Duty holder approval`)}>
          <Text style={s.approvalTitle}>Duty holder approval</Text>
          <Text style={s.approvalMeta}>
            {`${revLabel} · approved and issued ${formatDateUK(revision.issuedAt)}`}
          </Text>
          {revision.declarationText ? (
            <Text style={s.decl}>{revision.declarationText}</Text>
          ) : null}
          <View style={s.whoRow}>
            <View style={s.whoCell}>
              <Text style={s.label}>Approved by</Text>
              <Text style={s.controlDd}>
                {revision.signedName ?? revision.issuedByName ?? 'Not recorded'}
              </Text>
            </View>
            <View style={s.whoCell}>
              <Text style={s.label}>Position</Text>
              <Text style={s.controlDd}>
                {revision.approverRole ? titleCase(revision.approverRole) : 'Not recorded'}
              </Text>
            </View>
            <View style={s.whoCell}>
              <Text style={s.label}>Date</Text>
              <Text style={s.controlDd}>{formatDateUK(revision.issuedAt)}</Text>
            </View>
          </View>
          {revision.signatureImage ? (
            <Image style={s.sigImage} src={revision.signatureImage} />
          ) : revision.signedName ? (
            <Text style={s.sigTyped}>{revision.signedName}</Text>
          ) : (
            <View style={s.sigLine} />
          )}
          <Text style={s.sigCap}>
            {revision.signedName
              ? 'Signature of approver'
              : 'Issued before approval records were captured'}
          </Text>
        </View>

        {/* ── COLOPHON ── */}
        <View style={s.colophon}>
          <View>
            {logo && <Image style={s.colophonMark} src={logo} />}
            <Text style={s.colophonNote}>Prepared and issued in SiteComply</Text>
          </View>
        </View>

        {/* RUNNING FOOT — every page, and the direct replacement for the
            browser's URL/date/page furniture. Everything on it is document
            control: what this is, which revision, and a TRUE page number.

            Last in the flow and pushed down with marginTop:auto. The page
            number's Text is a direct child for the reason given above. */}
        <View style={s.runFoot} fixed>
          <Text style={s.runFootLeft}>{docRef}</Text>
          <Text
            style={s.runFootRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
