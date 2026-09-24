import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import {
  DOC,
  DocumentFooter,
  Fact,
  Masthead,
  Section,
  longDateTime,
  pageStyle,
  shortDateTime,
} from '@/services/pdfKit/documentKit';
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
 * ── THE CHROME IS THE SHARED KIT'S ─────────────────────────────────────────
 *
 * The masthead, the footer, the faces, the section rule and the date formats
 * come from services/pdfKit. This file holds only what is particular to a
 * permit: the verdict band, the validity window, the conditions and the
 * authorisation trail. The kit also closes the four engine traps that each
 * silently drop part of a document - see its notes.
 */

const s = StyleSheet.create({
  // ── the answer ──────────────────────────────────────────────────────────
  verdict: { marginTop: 14, borderLeftWidth: 3, paddingLeft: 12 },
  verdictHeading: { fontSize: 15, fontWeight: 700, letterSpacing: 0.4 },
  verdictText: { fontSize: 10, marginTop: 3, lineHeight: 1.45 },
  window: { flexDirection: 'row', marginTop: 10, gap: 26 },
  windowCell: {},
  windowLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.2, color: DOC.inkSubtle },
  windowValue: { fontSize: 11, fontWeight: 600, marginTop: 2 },

  name: { fontSize: 11, fontWeight: 600 },
  line: { fontSize: 9.5, color: DOC.inkMuted, lineHeight: 1.45 },
  cols: { flexDirection: 'row', gap: 28 },
  col: { flex: 1 },

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
  historyWhen: { width: 104, fontSize: 8.5, color: DOC.inkSubtle },
  historyWhat: { flex: 1, fontSize: 8.5, color: DOC.inkMuted, lineHeight: 1.45 },

  note: { fontSize: 8.5, color: DOC.inkSubtle, lineHeight: 1.45, marginTop: 6, fontStyle: 'italic' },
});

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
        <Text style={[s.conditionValue, answer.negative ? { color: DOC.red } : {}]}>
          {answer.value}
        </Text>
      </View>
    );
  }
  return (
    <View style={s.conditionBlock} wrap={false}>
      <Text style={s.conditionQuestion}>{answer.label}</Text>
      <Text style={[s.conditionAnswer, answer.negative ? { color: DOC.red } : {}]}>
        {answer.value}
      </Text>
    </View>
  );
}

export function PermitRecordPdf({ data }: { data: PermitRecordData }) {
  const brand = data.company.primaryColor || '#00AEEF';
  const tone = data.status.authorised ? DOC.green : data.status.value === 'REJECTED' ? DOC.red : DOC.amber;
  const auth = data.authorisation;

  return (
    <Document
      title={`Permit to Work — ${data.reference}`}
      author={data.company.name}
      subject={`${data.work.permitTypeName} · ${data.site.name}`}
      creator="SiteComply"
      producer="SiteComply"
    >
      <Page size="A4" style={pageStyle()}>
        <Masthead
          brand={data.company}
          title="PERMIT TO WORK"
          reference={data.reference}
        />

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
          THE GENERATION TIME IS NOT DECORATION. A permit's state changes - it
          expires, it can be cancelled - so a printed copy is only ever true as
          at the moment it was produced, and the reader is told exactly when.
        */}
        <DocumentFooter
          lines={[
            `${data.reference} · ${data.site.name} · ${data.work.permitTypeName}`,
            `Status shown as at ${shortDateTime(data.generatedAt)} · Produced by SiteComply`,
          ]}
        />
      </Page>
    </Document>
  );
}
