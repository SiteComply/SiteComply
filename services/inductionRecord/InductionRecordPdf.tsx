import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Svg,
  Path,
  Circle,
} from '@react-pdf/renderer';
import {
  DocumentFooter,
  Masthead,
  registerDocumentFonts,
  longDate,
  timeOnly,
} from '@/services/pdfKit/documentKit';
import type { InductionRecordData } from '@/services/inductionRecord/inductionRecordData';

/**
 * The SiteComply Site Induction Record.
 *
 * ── WHY THIS IS A PDF AND NOT A STYLED WEB PAGE ───────────────────────────
 *
 * The record this replaces was `window.print()` on the live worker app: it
 * printed the navigation, took the browser's default margins and furniture, and
 * rendered a phone-width column of shadowed cards down one side of an A4 sheet.
 * It read as a screenshot because it was one.
 *
 * Rendering server-side makes every copy identical regardless of who produced it
 * from what browser, which is the whole point of a document offered as evidence.
 *
 * ── THE DESIGN RULES, WHICH ARE LOAD-BEARING ──────────────────────────────
 *
 *   1. ONE PAGE by default. It flows to a second only where a site has added
 *      unusual amounts of content, and the header and footer repeat when it does.
 *   2. RULES AND WHITESPACE, NOT CARDS. No rounded corners, no drop shadows, no
 *      filled panels. Those are the specific tells that made the old output read
 *      as an application screen.
 *   3. MONOCHROME-SAFE. Every status is a word plus a mark; colour is never the
 *      only carrier of meaning. This gets printed on site-office lasers.
 *   4. COLOUR IS TRIM. The brand blue is a hairline rule and the section labels;
 *      the green is the completion mark. No large filled blocks — they read as
 *      marketing and cost ink.
 *   5. NOTHING IS ADDED BECAUSE THE DATA EXISTS. See inductionRecordData for the
 *      standard a field must meet.
 */

// Source Sans 3, bundled as WOFF and embedded in the PDF. The application's own
// stack is `ui-sans-serif, system-ui, …`, which cannot embed — a PDF asking for
// "system-ui" renders in whatever the reader substitutes, so the document would
// look different for every recipient. That is exactly the inconsistency this
// work exists to remove.
const INK = '#1A1D21';
const INK_MUTED = '#5B6570';
const INK_SUBTLE = '#8A929B';
const RULE = '#D8DDE2';
const GREEN = '#38B54A';

const s = StyleSheet.create({
  page: {
    fontFamily: 'SourceSans3',
    fontSize: 9.5,
    color: INK,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 46,
    // NO `lineHeight` HERE, deliberately.
    //
    // A unitless lineHeight on the Page silently breaks every `render`-prop
    // element in the document: the page-number text resolved to nothing at all,
    // on every page, while the rest of the footer printed normally. Overriding
    // lineHeight on the element itself does NOT rescue it — the property has to
    // be absent from the Page. Line spacing is therefore set on the individual
    // text styles below, which reads identically and keeps pagination working.
  },

  // ── masthead ────────────────────────────────────────────────────────────
  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: { height: 26, marginBottom: 4, objectFit: 'contain' },
  companyName: { fontSize: 11, fontWeight: 700 },
  tagline: { fontSize: 8, color: INK_SUBTLE },
  docTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1.1,
    textAlign: 'right',
  },
  docRef: { fontSize: 8, color: INK_MUTED, textAlign: 'right', marginTop: 2 },
  brandRule: { height: 2, marginTop: 10 },

  // ── status ──────────────────────────────────────────────────────────────
  status: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  statusMark: { marginRight: 10 },
  statusHeading: { fontSize: 14, fontWeight: 700, letterSpacing: 0.3 },
  statusMeta: { fontSize: 9.5, color: INK_MUTED, marginTop: 1, lineHeight: 1.45 },

  // ── sections ────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  rule: { borderBottomWidth: 0.75, borderBottomColor: RULE },
  block: { marginTop: 16, paddingTop: 12 },

  cols: { flexDirection: 'row', gap: 28 },
  col: { flex: 1 },

  name: { fontSize: 11, fontWeight: 600 },
  line: { fontSize: 9.5, color: INK_MUTED, lineHeight: 1.45 },
  fact: { flexDirection: 'row', marginTop: 1 },
  factLabel: { width: 92, fontSize: 9.5, color: INK_SUBTLE },
  factValue: { flex: 1, fontSize: 9.5, color: INK_MUTED, lineHeight: 1.45 },

  // ── acknowledgements ────────────────────────────────────────────────────
  ack: { flexDirection: 'row', marginBottom: 4 },
  ackMark: { width: 14, paddingTop: 3 },
  ackText: { flex: 1, fontSize: 9.5, lineHeight: 1.45 },
  ackNote: { fontSize: 8.5, color: INK_SUBTLE, marginLeft: 14, marginTop: -3, lineHeight: 1.45 },

  inlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  inlineValue: { fontSize: 10, fontWeight: 600 },

  // ── declaration ─────────────────────────────────────────────────────────
  declaration: { fontSize: 9.5, fontStyle: 'italic', color: INK_MUTED, lineHeight: 1.45 },
  signatureImage: { height: 42, objectFit: 'contain', alignSelf: 'flex-start' },
  signatureTyped: { fontSize: 16, marginTop: 6 },
  signatureRule: {
    borderBottomWidth: 0.75,
    borderBottomColor: INK,
    width: 200,
    marginTop: 4,
  },
  signedBy: { fontSize: 8.5, color: INK_MUTED, marginTop: 3 },

  // ── footer ──────────────────────────────────────────────────────────────
  footer: {
    // Pushed to the foot of the page by `marginTop: auto` rather than absolute
    // positioning, and the RULE IS A BORDER on this same element rather than a
    // separate View.
    //
    // Both choices are the result of measurement, not preference. An absolutely
    // positioned footer renders fine in isolation but produced nothing at all
    // inside this page; and the page-number Text only resolves its render prop
    // when it is a DIRECT child of the fixed element — nested one level deeper,
    // every other footer line printed and the page number silently did not.
    // A compliance document that quietly loses its pagination is worse than one
    // that fails loudly, so the structure here is kept deliberately flat.
    marginTop: 'auto',
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: RULE,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  footerLeft: { flexGrow: 1, flexShrink: 1 },
  footerRight: { width: 92, textAlign: 'right' },
  footerText: { fontSize: 7.5, color: INK_SUBTLE },
});

/**
 * Dates come from the shared kit, and are formatted in EUROPE/LONDON.
 *
 * They used to be formatted here from the UTC parts of the Date. That is an
 * hour out for half the year, and around midnight in summer it printed the
 * WRONG DAY: an induction completed at 00:30 BST on 2 July was recorded as
 * 1 July. On a document whose entire purpose is to record when somebody was
 * inducted, that is not a formatting preference.
 */
function shortDateTime(d: Date): string {
  return `${longDate(d)}, ${timeOnly(d)}`;
}

/**
 * The confirmation marks are DRAWN, not typed.
 *
 * A check mark is U+2713, and the bundled Source Sans 3 is the Latin subset,
 * which does not contain it. @react-pdf does not fail loudly on a missing glyph:
 * it silently falls back to Helvetica, and Helvetica has no U+2713 either — so
 * the first version of this document rendered every tick as NOTHING. The page
 * looked plausible and asserted nothing, which is the worst way for a compliance
 * document to be wrong.
 *
 * Drawing the mark as vector removes the dependency entirely: it cannot go
 * missing, it scales cleanly, and it keeps the PDF free of unembedded fonts.
 */
function CheckMark({ size = 9, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 13 L9 18 L20 6"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** An unconfirmed item: a dash, so absence reads as deliberate, not as a gap. */
function DashMark({ size = 9, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12 L19 12" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

/** The completion mark: a white check inside a filled brand-green disc. */
function StatusMark() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" style={s.statusMark}>
      <Circle cx={12} cy={12} r={12} fill={GREEN} />
      <Path
        d="M6.5 12.5 L10.5 16.5 L17.5 8"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function Section({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[s.block, s.rule, { borderBottomWidth: 0 }]}>
      <View style={[s.rule, { marginBottom: 10 }]} />
      <Text style={[s.sectionLabel, { color }]}>{label}</Text>
      {children}
    </View>
  );
}

export function InductionRecordPdf({ data }: { data: InductionRecordData }) {
  const brand = data.company.primaryColor || '#00AEEF';
  const { induction: ind, declaration: dec } = data;

  const knowledgeCheckText =
    ind.knowledgeCheck === 'passed'
      ? ind.knowledgeCheckCount
        ? `Passed · ${ind.knowledgeCheckCount} of ${ind.knowledgeCheckCount}`
        : 'Passed'
      : ind.knowledgeCheck === 'not-required'
        ? 'Not required for this site'
        : 'Not passed';

  return (
    <Document
      title={`Site Induction Record — ${data.operative.name}`}
      author={data.company.name}
      subject={`${data.site.name} · ${longDate(ind.completedAt)}`}
      creator="SiteComply"
      producer="SiteComply"
    >
      <Page size="A4" style={s.page}>
        {/* The shared masthead: same logo, name and brand rule on every
            SiteComply document, and the document reference set the same way. */}
        <Masthead
          brand={data.company}
          title="SITE INDUCTION RECORD"
          reference={data.documentReference}
        />

        {/* ── Outcome, stated once and plainly ── */}
        <View style={s.status}>
          <StatusMark />
          <View>
            <Text style={s.statusHeading}>INDUCTION COMPLETE</Text>
            <Text style={s.statusMeta}>
              {data.site.name} · {longDate(ind.completedAt)} ·{' '}
              {timeOnly(ind.completedAt)}
            </Text>
          </View>
        </View>

        {/* A carried-forward induction must say so, or the date above reads as
            the day the induction was delivered when it was not. */}
        {ind.carriedForwardFrom ? (
          <Text style={[s.statusMeta, { marginTop: 6 }]}>
            Induction carried forward from {longDate(ind.carriedForwardFrom)}.
            The operative was inducted on that date and this check-in reused it.
          </Text>
        ) : null}

        {/* ── Who and where ── */}
        <View style={[s.block, { paddingTop: 0 }]}>
          <View style={[s.rule, { marginBottom: 10 }]} />
          <View style={s.cols}>
            <View style={s.col}>
              <Text style={[s.sectionLabel, { color: brand }]}>OPERATIVE</Text>
              <Text style={s.name}>{data.operative.name}</Text>
              <Text style={s.line}>{data.operative.company}</Text>
              {data.operative.cscs ? (
                <Text style={[s.line, { marginTop: 3 }]}>
                  {data.operative.cscs}
                </Text>
              ) : null}
            </View>
            <View style={s.col}>
              <Text style={[s.sectionLabel, { color: brand }]}>SITE</Text>
              <Text style={s.name}>{data.site.name}</Text>
              <View style={s.fact}>
                <Text style={s.factLabel}>Job reference</Text>
                <Text style={s.factValue}>{data.site.jobReference}</Text>
              </View>
              {data.site.address.length > 0 ? (
                <View style={s.fact}>
                  <Text style={s.factLabel}>Address</Text>
                  {/* ONE Text with an explicit break, not two stacked Texts.
                      Two siblings each carry their own line box and the pair
                      rendered visibly tighter than every other row; a single
                      Text uses one consistent leading. The break keeps the
                      postcode whole — a postcode split across a wrap reads as a
                      typo on a document someone files as evidence. */}
                  <Text style={s.factValue}>
                    {`${data.site.address.slice(0, -1).join(', ')}\n${data.site.address[data.site.address.length - 1]}`}
                  </Text>
                </View>
              ) : null}
              {data.site.principalContractor ? (
                <View style={s.fact}>
                  <Text style={s.factLabel}>Principal contractor</Text>
                  <Text style={s.factValue}>
                    {data.site.principalContractor}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── What was agreed. Verbatim: this is the evidential core, and a
               summary of it would be worth considerably less. ── */}
        <Section label="ACKNOWLEDGEMENTS" color={brand}>
          {ind.acknowledgements.map((a, i) => (
            <View key={i} wrap={false}>
              <View style={s.ack}>
                <View style={s.ackMark}>
                  {a.confirmed ? (
                    <CheckMark color={GREEN} />
                  ) : (
                    <DashMark color={INK_SUBTLE} />
                  )}
                </View>
                <Text style={s.ackText}>{a.label}</Text>
              </View>
              {/* The rules are REFERENCED, not reproduced. The version pins
                  exactly which ones, so the record stays traceable without
                  carrying ten more lines a reader will not read. */}
              {ind.siteRuleCount > 0 &&
              /site rules/i.test(a.label) ? (
                <Text style={s.ackNote}>
                  {ind.siteRuleCount} site rules presented at induction version{' '}
                  {ind.version}
                </Text>
              ) : null}
            </View>
          ))}

          {ind.ppeCount > 0 ? (
            <View style={s.ack}>
              <View style={s.ackMark}>
                {ind.ppeConfirmed ? (
                  <CheckMark color={GREEN} />
                ) : (
                  <DashMark color={INK_SUBTLE} />
                )}
              </View>
              <Text style={s.ackText}>
                Personal protective equipment confirmed — {ind.ppeCount} items
              </Text>
            </View>
          ) : null}
          <View style={s.ack}>
            <View style={s.ackMark}>
              {ind.gdprConsent ? (
                <CheckMark color={GREEN} />
              ) : (
                <DashMark color={INK_SUBTLE} />
              )}
            </View>
            <Text style={s.ackText}>Data protection consent given</Text>
          </View>
        </Section>

        <Section label="KNOWLEDGE CHECK" color={brand}>
          <View style={s.inlineRow}>
            <Text style={s.line}>Site induction knowledge check</Text>
            <Text style={s.inlineValue}>{knowledgeCheckText}</Text>
          </View>
        </Section>

        {/* ── The signature. Kept whole: a declaration split across a page break
               is the one thing on this document that must never happen. ── */}
        <View wrap={false}>
          <Section label="DECLARATION" color={brand}>
            {dec.text ? (
              <Text style={s.declaration}>“{dec.text}”</Text>
            ) : (
              <Text style={s.declaration}>
                The operative confirmed completion of this site induction.
              </Text>
            )}
            <View style={{ marginTop: 12 }}>
              {dec.signatureImage ? (
                <Image style={s.signatureImage} src={dec.signatureImage.bytes} />
              ) : (
                <Text style={s.signatureTyped}>
                  {dec.signedName ?? data.operative.name}
                </Text>
              )}
              <View style={s.signatureRule} />
              <Text style={s.signedBy}>
                {dec.signedName ?? data.operative.name}
                {dec.signedAt ? ` · ${shortDateTime(dec.signedAt)}` : ''}
              </Text>
            </View>
          </Section>
        </View>

        {/* The shared footer, which is also where the page numbers live. */}
        <DocumentFooter
          lines={[
            `Induction version ${ind.version} · Check-in reference ${data.checkInReference}`,
            `${data.documentReference} · Generated ${shortDateTime(data.generatedAt)} · Produced by SiteComply`,
          ]}
        />
      </Page>
    </Document>
  );
}
