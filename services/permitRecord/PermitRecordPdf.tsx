import React from 'react';
import path from 'path';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type {
  PermitRecordAnswer,
  PermitRecordData,
} from '@/services/permitRecord/permitRecordData';

/**
 * The permit, as a controlled document.
 *
 * ── WHAT A READER NEEDS, IN THE ORDER THEY NEED IT ────────────────────────
 *
 * Somebody holding this at a work face is answering one question: may this work
 * go ahead, right now? So the answer is the first thing on the page, in words,
 * with the time it stops being true directly under it. Everything else - who
 * asked, what they said they would do, who authorised it - comes after, because
 * none of it matters if the answer is no.
 *
 * ── IT DOES NOT FLATTER THE PERMIT ────────────────────────────────────────
 *
 * An expired, refused or cancelled permit is printed as plainly as an approved
 * one. The temptation with a document like this is to make it look official and
 * therefore authoritative; a permit that looks authoritative when it authorises
 * nothing is the failure mode that gets somebody hurt.
 *
 * ── THE SAME TYPE AS THE INDUCTION RECORD ─────────────────────────────────
 *
 * Source Sans 3, matching services/inductionRecord. The two are the same KIND
 * of document - an operational record of something a person did or was allowed
 * to do - and they will sit in the same project file. The construction phase
 * plan is set differently on purpose: it is an issued, revision-controlled plan
 * rather than a record of an event.
 */

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

/**
 * Registered once per process. See the induction record for why the faces are
 * committed rather than resolved from node_modules: a document whose appearance
 * depends on the install tree is not a controlled document.
 */
let registered = false;
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: 'SourceSans3',
    fonts: [
      { src: path.join(FONT_DIR, 'SourceSans3-400.woff'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'SourceSans3-600.woff'), fontWeight: 600 },
      { src: path.join(FONT_DIR, 'SourceSans3-700.woff'), fontWeight: 700 },
      {
        src: path.join(FONT_DIR, 'SourceSans3-400-italic.woff'),
        fontWeight: 400,
        fontStyle: 'italic',
      },
    ],
  });
  // @react-pdf hyphenates by default, which breaks a permit reference or a
  // postcode across a line and makes it unquotable.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

const INK = '#1A1D21';
const INK_MUTED = '#5B6570';
const INK_SUBTLE = '#8A929B';
const RULE = '#D8DDE2';
const GREEN = '#2E8B3F';
const RED = '#B3261E';
const AMBER = '#8A6A0B';

const s = StyleSheet.create({
  page: {
    fontFamily: 'SourceSans3',
    fontSize: 9.5,
    color: INK,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 46,
    // NO lineHeight on the Page: a unitless value here silently stops every
    // `render`-prop element resolving, which takes the page numbers with it.
    // The induction record documents this trap; it is the same engine.
  },

  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: { height: 26, marginBottom: 4, objectFit: 'contain' },
  companyName: { fontSize: 11, fontWeight: 700 },
  tagline: { fontSize: 8, color: INK_SUBTLE },
  docTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 1.1, textAlign: 'right' },
  docRef: { fontSize: 9, color: INK_MUTED, textAlign: 'right', marginTop: 2, fontWeight: 600 },
  brandRule: { height: 2, marginTop: 10 },

  // ── the answer ──────────────────────────────────────────────────────────
  verdict: { marginTop: 14, borderLeftWidth: 3, paddingLeft: 12 },
  verdictHeading: { fontSize: 15, fontWeight: 700, letterSpacing: 0.4 },
  verdictText: { fontSize: 10, marginTop: 3, lineHeight: 1.45 },
  window: { flexDirection: 'row', marginTop: 10, gap: 26 },
  windowCell: {},
  windowLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.2, color: INK_SUBTLE },
  windowValue: { fontSize: 11, fontWeight: 600, marginTop: 2 },

  sectionLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.2, marginBottom: 6 },
  rule: { borderBottomWidth: 0.75, borderBottomColor: RULE },
  // Tight on purpose: a permit that runs to two pages gets carried as one.
  block: { marginTop: 10, paddingTop: 8 },

  cols: { flexDirection: 'row', gap: 28 },
  col: { flex: 1 },

  name: { fontSize: 11, fontWeight: 600 },
  line: { fontSize: 9.5, color: INK_MUTED, lineHeight: 1.45 },
  fact: { flexDirection: 'row', marginTop: 2 },
  factLabel: { width: 96, fontSize: 9.5, color: INK_SUBTLE },
  factValue: { flex: 1, fontSize: 9.5, color: INK_MUTED, lineHeight: 1.45 },

  // ── conditions ──────────────────────────────────────────────────────────
  condition: { flexDirection: 'row', marginBottom: 3 },
  conditionLabel: { flex: 1, fontSize: 9.5, lineHeight: 1.45, paddingRight: 12 },
  conditionValue: { width: 88, fontSize: 9.5, fontWeight: 600, textAlign: 'right' },
  conditionBlock: { marginBottom: 5 },
  /*
   * A SEPARATE STYLE FROM conditionLabel, which carries `flex: 1` for the row
   * layout. Reused in this stacked block, that flex collapsed the question to
   * zero height and printed the answer straight on top of it — legible in
   * neither direction, and visible only by looking at a rendered page.
   */
  conditionQuestion: { fontSize: 9.5, lineHeight: 1.45 },
  conditionAnswer: { fontSize: 9.5, fontWeight: 600, marginTop: 1, lineHeight: 1.4 },

  historyRow: { flexDirection: 'row', marginBottom: 2 },
  historyWhen: { width: 104, fontSize: 8.5, color: INK_SUBTLE },
  historyWhat: { flex: 1, fontSize: 8.5, color: INK_MUTED, lineHeight: 1.45 },

  note: { fontSize: 8.5, color: INK_SUBTLE, lineHeight: 1.45, marginTop: 6, fontStyle: 'italic' },

  footer: {
    /*
     * PUSHED DOWN BY `marginTop: auto`, NOT POSITIONED ABSOLUTELY, and the rule
     * is a border on this same element rather than a separate View.
     *
     * Both are measured, not preferred. An absolutely positioned footer renders
     * perfectly in isolation and produced NOTHING AT ALL on a full page here -
     * no rule, no text, no page number, no error. The induction record records
     * the same finding; this document repeated the mistake before copying it.
     */
    marginTop: 'auto',
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: RULE,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  footerLeft: { flex: 1 },
  /*
   * NO lineHeight HERE. A unitless lineHeight breaks a `render`-prop element
   * exactly as one on the Page does: the page number resolved to nothing at
   * all, on every page, while the rest of the footer printed normally. The
   * working document has none either - that is why.
   */
  footerText: { fontSize: 7.5, color: INK_SUBTLE },
  /*
   * AN EXPLICIT WIDTH, or the page number vanishes. In a flex row whose left
   * cell is `flex: 1`, a Text with no width is squeezed to nothing and prints
   * silently as empty - the footer looks finished and the pagination is gone.
   */
  footerRight: { width: 92, textAlign: 'right' },
});

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Europe/London, always — a permit's times are site times, and a document that
 * silently printed UTC would be an hour out for half the year, on exactly the
 * field a reader relies on.
 */
function parts(d: Date): { day: number; month: number; year: number; hh: string; mm: string } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return {
    day: Number(get('day')),
    month: Number(get('month')),
    year: Number(get('year')),
    hh: get('hour'),
    mm: get('minute'),
  };
}

export function longDateTime(d: Date): string {
  const p = parts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} at ${p.hh}:${p.mm}`;
}
export function shortDateTime(d: Date): string {
  const p = parts(d);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year} ${p.hh}:${p.mm}`;
}

/**
 * A titled block.
 *
 * `minPresenceAhead` is the "keep with next" this engine gives us: a heading
 * with less than this much room under it moves to the next page instead of
 * sitting alone at the foot of this one. Without it the HISTORY heading printed
 * at the bottom of page one and every one of its rows on page two.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.block} minPresenceAhead={56}>
      <View style={s.rule} />
      <View style={{ paddingTop: 8 }}>
        <Text style={[s.sectionLabel, { color: INK_SUBTLE }]}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

/** Answers longer than this read badly squeezed into the right-hand column. */
const SHORT_ANSWER = 24;

/**
 * One question and its answer.
 *
 * A short answer sits in the right-hand column where it can be scanned down the
 * page — Yes, Yes, No. A LONG one goes underneath the question instead: ranged
 * right over three lines, "M. Marshal — 60 minutes after completion" was both
 * ugly and slower to read than the question it answered.
 */
function Condition({ answer }: { answer: PermitRecordAnswer }) {
  const short = answer.value.length <= SHORT_ANSWER;
  if (short) {
    return (
      <View style={s.condition} wrap={false}>
        <Text style={s.conditionLabel}>{answer.label}</Text>
        <Text style={[s.conditionValue, answer.negative ? { color: RED } : {}]}>
          {answer.value}
        </Text>
      </View>
    );
  }
  return (
    <View style={s.conditionBlock} wrap={false}>
      <Text style={s.conditionQuestion}>{answer.label}</Text>
      <Text style={[s.conditionAnswer, answer.negative ? { color: RED } : {}]}>
        {answer.value}
      </Text>
    </View>
  );
}

export function PermitRecordPdf({ data }: { data: PermitRecordData }) {
  const brand = data.company.primaryColor || '#00AEEF';
  const tone = data.status.authorised ? GREEN : data.status.value === 'REJECTED' ? RED : AMBER;
  const auth = data.authorisation;

  return (
    <Document
      title={`Permit to Work — ${data.reference}`}
      author={data.company.name}
      subject={`${data.work.permitTypeName} · ${data.site.name}`}
      creator="SiteComply"
      producer="SiteComply"
    >
      <Page size="A4" style={s.page}>
        <View fixed>
          <View style={s.masthead}>
            <View>
              {data.company.logo ? (
                <Image style={s.logo} src={data.company.logo.bytes} />
              ) : null}
              <Text style={s.companyName}>{data.company.name}</Text>
              {data.company.tagline ? (
                <Text style={s.tagline}>{data.company.tagline}</Text>
              ) : null}
            </View>
            <View>
              <Text style={s.docTitle}>PERMIT TO WORK</Text>
              <Text style={s.docRef}>{data.reference}</Text>
            </View>
          </View>
          <View style={[s.brandRule, { backgroundColor: brand }]} />
        </View>

        {/* ── The answer to the only question that matters here ── */}
        <View style={[s.verdict, { borderLeftColor: tone }]}>
          <Text style={[s.verdictHeading, { color: tone }]}>
            {data.status.authorised ? 'AUTHORISED' : data.status.label.toUpperCase()}
          </Text>
          <Text style={s.verdictText}>{data.status.statement}</Text>

          {(data.validity.from || data.validity.until) && (
            <View style={s.window}>
              {data.validity.from && (
                <View style={s.windowCell}>
                  <Text style={s.windowLabel}>VALID FROM</Text>
                  <Text style={s.windowValue}>{longDateTime(data.validity.from)}</Text>
                </View>
              )}
              {data.validity.until && (
                <View style={s.windowCell}>
                  <Text style={s.windowLabel}>VALID UNTIL</Text>
                  <Text style={[s.windowValue, { color: tone }]}>
                    {longDateTime(data.validity.until)}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <Section title="THE WORK">
          <Text style={s.name}>{data.work.permitTypeName}</Text>
          <Text style={[s.line, { marginTop: 2 }]}>{data.work.activity}</Text>
          <View style={{ marginTop: 6 }}>
            {data.work.location ? <Fact label="Location" value={data.work.location} /> : null}
            {data.work.proposedStart ? (
              <Fact label="Proposed start" value={longDateTime(data.work.proposedStart)} />
            ) : null}
            {data.work.proposedFinish ? (
              <Fact label="Proposed finish" value={longDateTime(data.work.proposedFinish)} />
            ) : null}
          </View>
        </Section>

        <View style={s.cols}>
          <View style={s.col}>
            <Section title="OPERATIVE">
              <Text style={s.name}>{data.operative.name}</Text>
              {data.operative.company ? (
                <Text style={s.line}>{data.operative.company}</Text>
              ) : null}
            </Section>
          </View>
          <View style={s.col}>
            <Section title="PROJECT">
              <Text style={s.name}>{data.site.name}</Text>
              <Text style={s.line}>{data.site.jobReference}</Text>
              {data.site.address.map((l) => (
                <Text key={l} style={s.line}>{l}</Text>
              ))}
              {data.site.principalContractor ? (
                <Text style={[s.line, { marginTop: 3 }]}>
                  Principal contractor: {data.site.principalContractor}
                </Text>
              ) : null}
            </Section>
          </View>
        </View>

        {data.conditions.length > 0 && (
          <Section title="CONDITIONS CONFIRMED BEFORE THE WORK">
            {data.conditions.map((c, i) => (
              <Condition key={`${c.label}-${i}`} answer={c} />
            ))}
            <Text style={s.note}>
              These are the answers given when the permit was requested, in the
              words the question was asked. They are part of the authorisation:
              if any of them has stopped being true, the permit no longer covers
              the work.
            </Text>
          </Section>
        )}

        <Section title="AUTHORISATION">
          <Fact
            label="Requested by"
            value={`${auth.submittedBy} · ${longDateTime(auth.submittedAt)}`}
          />
          {auth.reviewedBy && auth.reviewedAt ? (
            <Fact
              label="Reviewed by"
              value={`${auth.reviewedBy} · ${longDateTime(auth.reviewedAt)}`}
            />
          ) : null}
          {auth.approvedBy && auth.approvedAt ? (
            <Fact
              label="Approved by"
              value={`${auth.approvedBy} · ${longDateTime(auth.approvedAt)}`}
            />
          ) : null}
          {auth.rejectedBy && auth.rejectedAt ? (
            <Fact
              label="Refused by"
              value={`${auth.rejectedBy} · ${longDateTime(auth.rejectedAt)}`}
            />
          ) : null}
          {auth.rejectionReason ? (
            <Fact label="Reason" value={auth.rejectionReason} />
          ) : null}
          {auth.cancelledAt ? (
            <Fact label="Cancelled" value={longDateTime(auth.cancelledAt)} />
          ) : null}
          {auth.closedAt ? (
            <Fact
              label="Closed"
              value={`${auth.closedBy ? `${auth.closedBy} · ` : ''}${longDateTime(auth.closedAt)}`}
            />
          ) : null}
        </Section>

        {data.history.length > 0 && (
          <Section title="HISTORY">
            {data.history.map((h, i) => (
              <View key={i} style={s.historyRow} wrap={false}>
                <Text style={s.historyWhen}>{shortDateTime(h.at)}</Text>
                <Text style={s.historyWhat}>
                  {h.what}
                  {h.who ? ` · ${h.who}` : ''}
                  {h.note ? ` — ${h.note}` : ''}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {/*
          `fixed` so every page carries it, and the page-number Text below is a
          DIRECT CHILD of this element - nested one level deeper, every other
          footer line prints and the page number silently does not.
        */}
        <View style={s.footer} fixed>
          <View style={s.footerLeft}>
            <Text style={s.footerText}>
              {`${data.reference} · ${data.site.name} · ${data.work.permitTypeName}`}
            </Text>
            {/*
              THE GENERATION TIME IS NOT DECORATION. A permit's state changes -
              it expires, it can be cancelled - so a printed copy is only ever
              true as at the moment it was produced, and the reader is told
              exactly when that was.
            */}
            <Text style={s.footerText}>
              {`Status shown as at ${shortDateTime(data.generatedAt)} · Produced by SiteComply`}
            </Text>
          </View>
          <Text
            style={[s.footerText, s.footerRight]}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
