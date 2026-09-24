import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import {
  DOC,
  DocumentFooter,
  Masthead,
  pageStyle,
  longDate,
  shortDateTime,
  type DocumentBrand,
} from '@/services/pdfKit/documentKit';

/**
 * The project close-out pack, as a document.
 *
 * ── THE ONE THING IN THIS PRODUCT A CLIENT ACTUALLY RECEIVES ──────────────
 *
 * Everything else here is read by the people who made it. A close-out pack is
 * handed over - to a client, a principal contractor, a building owner - and it
 * is what they keep. Until now it was an HTML file inside a ZIP, which a
 * recipient opens in a browser and prints themselves, complete with their own
 * URL and timestamp across the top. That is the first impression the whole
 * platform makes on somebody who never logs into it.
 *
 * ── AI PROSE IS LABELLED EVERY TIME IT APPEARS ────────────────────────────
 *
 * The pack can carry a machine-written narrative. It is badged at every
 * occurrence and carries the same disclaimer the on-screen pack shows - not
 * once at the front, where a reader who opens at section six would never see
 * it. This is the copy that gets filed and read years later; unlabelled machine
 * prose in it would be worse than none at all.
 *
 * ── THE COVER IS A COVER ──────────────────────────────────────────────────
 *
 * Its own page, with the project, who it was prepared for and by, the date and
 * the version. A handover document that starts straight into section one reads
 * like a printout of something else.
 */

export interface PackSectionForPdf {
  id: string;
  label: string;
  facts?: { label: string; value: string }[];
  rows?: { label: string; value: string }[][];
  photos?: { id: string; caption: string }[];
  cappedNote?: string;
  /** Machine-written prose for this section, if the pack has any. */
  narrative?: string | null;
}

export interface CloseOutPackPdfData {
  brand: DocumentBrand;
  title: string;
  version: number;
  preparedFor: string | null;
  generatedByName: string;
  generatedAt: Date;
  site: { name: string; jobReference: string; address: string };
  sections: PackSectionForPdf[];
  executiveSummary: string | null;
  appendices: { ref: string; title: string; source: string }[];
  /** True when the archive this document sits in also carries the files. */
  appendicesIncluded: boolean;
}

const AI_DISCLAIMER =
  'This narrative was written automatically from the records held in this ' +
  'project. It is a descriptive summary only — not an assessment, ' +
  'certification or approval of compliance. The project team remains ' +
  'responsible for the accuracy and completeness of this pack.';

/**
 * The short form, used on every section narrative after the first.
 *
 * THE BADGE APPEARS EVERY TIME; the three-line disclaimer does not. A reader
 * who opens at section six must still be told the prose is machine-written -
 * that is not negotiable - but repeating the full paragraph eight times reads
 * as boilerplate, and boilerplate is what people stop seeing.
 */
const AI_NOTE_SHORT =
  'Written automatically from this project’s records. Not an assessment of compliance.';

const s = StyleSheet.create({
  cover: { marginTop: 90, alignItems: 'center' },
  coverLogo: { height: 44, marginBottom: 18, objectFit: 'contain' },
  coverCompany: { fontSize: 10, fontWeight: 700, letterSpacing: 2 },
  coverTagline: { fontSize: 8.5, color: DOC.inkSubtle, marginTop: 2 },
  coverSite: { fontSize: 26, fontWeight: 700, marginTop: 28, textAlign: 'center' },
  coverKind: { fontSize: 11, letterSpacing: 3, color: DOC.inkMuted, marginTop: 8 },
  coverRule: { height: 2, width: 120, marginTop: 20 },
  coverMeta: { flexDirection: 'row', marginTop: 34, gap: 40 },
  coverMetaCell: { width: 190 },
  coverMetaLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.2, color: DOC.inkSubtle },
  coverMetaValue: { fontSize: 10, marginTop: 3, lineHeight: 1.45 },
  coverIssued: { fontSize: 8.5, color: DOC.inkSubtle, marginTop: 40 },

  contentsRow: { flexDirection: 'row', marginBottom: 3 },
  contentsNum: { width: 22, fontSize: 9.5, color: DOC.inkSubtle },
  contentsLabel: { flex: 1, fontSize: 9.5 },

  sectionHeading: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  sectionRule: { height: 1.5, width: 40, marginBottom: 10 },

  ai: {
    borderLeftWidth: 2,
    borderLeftColor: DOC.green,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  aiBadge: { fontSize: 6.5, fontWeight: 700, letterSpacing: 1, color: DOC.green },
  aiText: { fontSize: 9.5, lineHeight: 1.5, marginTop: 3 },
  aiNote: { fontSize: 7.5, color: DOC.inkSubtle, lineHeight: 1.4, marginTop: 4, fontStyle: 'italic' },

  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  factCell: { width: '50%', paddingRight: 14, marginBottom: 6 },
  factLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: DOC.inkSubtle },
  factValue: { fontSize: 9.5, marginTop: 1, lineHeight: 1.45 },

  tableHead: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: DOC.rule, paddingBottom: 3 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#EDF0F2', paddingVertical: 3 },
  th: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: DOC.inkSubtle },
  td: { fontSize: 9, color: DOC.ink, lineHeight: 1.4, paddingRight: 8 },

  photo: { fontSize: 9, color: DOC.inkMuted, lineHeight: 1.45, marginBottom: 2 },
  capped: { fontSize: 8, color: DOC.amber, marginTop: 6, lineHeight: 1.4 },
  empty: { fontSize: 9, color: DOC.inkSubtle, fontStyle: 'italic' },
});

/** Column widths that add to one, so a table never runs off the page. */
function columnWidths(count: number): string[] {
  if (count <= 1) return ['100%'];
  const even = Math.floor(100 / count);
  // The first column carries the identifying value and gets the remainder.
  const first = 100 - even * (count - 1);
  return [`${first}%`, ...Array(count - 1).fill(`${even}%`)];
}

function AiNarrative({ text, full = false }: { text: string; full?: boolean }) {
  return (
    <View style={s.ai} wrap={false}>
      <Text style={s.aiBadge}>AI-GENERATED</Text>
      <Text style={s.aiText}>{text}</Text>
      <Text style={s.aiNote}>{full ? AI_DISCLAIMER : AI_NOTE_SHORT}</Text>
    </View>
  );
}

function SectionBody({ section }: { section: PackSectionForPdf }) {
  const hasFacts = (section.facts?.length ?? 0) > 0;
  const hasRows = (section.rows?.length ?? 0) > 0;
  const hasPhotos = (section.photos?.length ?? 0) > 0;
  const widths = hasRows ? columnWidths(section.rows![0]!.length) : [];

  return (
    <View>
      {section.narrative ? <AiNarrative text={section.narrative} /> : null}

      {hasFacts && (
        <View style={s.facts}>
          {section.facts!.map((f, i) => (
            <View key={`${f.label}-${i}`} style={s.factCell}>
              <Text style={s.factLabel}>{f.label.toUpperCase()}</Text>
              <Text style={s.factValue}>{f.value}</Text>
            </View>
          ))}
        </View>
      )}

      {hasRows && (
        <View style={{ marginTop: hasFacts ? 8 : 0 }}>
          <View style={s.tableHead} fixed>
            {section.rows![0]!.map((c, i) => (
              <Text key={i} style={[s.th, { width: widths[i] }]}>
                {c.label.toUpperCase()}
              </Text>
            ))}
          </View>
          {section.rows!.map((row, r) => (
            <View key={r} style={s.tableRow} wrap={false}>
              {row.map((c, i) => (
                <Text key={i} style={[s.td, { width: widths[i] }]}>
                  {c.value}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}

      {hasPhotos && (
        <View style={{ marginTop: hasRows || hasFacts ? 8 : 0 }}>
          {section.photos!.map((p) => (
            <Text key={p.id} style={s.photo}>
              • {p.caption}
            </Text>
          ))}
        </View>
      )}

      {!hasFacts && !hasRows && !hasPhotos && !section.narrative && (
        <Text style={s.empty}>Nothing was recorded against this section.</Text>
      )}

      {section.cappedNote ? <Text style={s.capped}>{section.cappedNote}</Text> : null}
    </View>
  );
}

export function CloseOutPackPdf({ data }: { data: CloseOutPackPdfData }) {
  const brandColour = data.brand.primaryColor || '#00AEEF';
  const footer = [
    `${data.site.name} · ${data.site.jobReference} · Close-out pack version ${data.version}.0`,
    `Prepared by ${data.generatedByName} · ${shortDateTime(data.generatedAt)} · Produced by SiteComply`,
  ];

  return (
    <Document
      title={data.title}
      author={data.brand.name}
      subject={`Project close-out pack — ${data.site.name}`}
      creator="SiteComply"
      producer="SiteComply"
    >
      {/* ── Cover: its own page, no running head ── */}
      <Page size="A4" style={pageStyle()}>
        <View style={s.cover}>
          {data.brand.logo ? (
            <Image style={s.coverLogo} src={data.brand.logo.bytes} />
          ) : null}
          <Text style={s.coverCompany}>{data.brand.name.toUpperCase()}</Text>
          {data.brand.tagline ? (
            <Text style={s.coverTagline}>{data.brand.tagline}</Text>
          ) : null}

          <Text style={s.coverSite}>{data.site.name}</Text>
          <Text style={s.coverKind}>PROJECT CLOSE-OUT PACK</Text>
          <View style={[s.coverRule, { backgroundColor: brandColour }]} />

          <View style={s.coverMeta}>
            <View style={s.coverMetaCell}>
              <Text style={s.coverMetaLabel}>PROJECT ADDRESS</Text>
              <Text style={s.coverMetaValue}>{data.site.address}</Text>
              <Text style={[s.coverMetaLabel, { marginTop: 14 }]}>JOB REFERENCE</Text>
              <Text style={s.coverMetaValue}>{data.site.jobReference}</Text>
            </View>
            <View style={s.coverMetaCell}>
              <Text style={s.coverMetaLabel}>PREPARED FOR</Text>
              <Text style={s.coverMetaValue}>{data.preparedFor ?? '—'}</Text>
              <Text style={[s.coverMetaLabel, { marginTop: 14 }]}>PREPARED BY</Text>
              <Text style={s.coverMetaValue}>{data.generatedByName}</Text>
            </View>
          </View>

          <Text style={s.coverIssued}>
            {`Issued ${longDate(data.generatedAt)} · Version ${data.version}.0`}
          </Text>
        </View>

        <DocumentFooter lines={footer} />
      </Page>

      {/* ── Contents, the summary, then the sections ── */}
      <Page size="A4" style={pageStyle()}>
        <Masthead
          brand={data.brand}
          title="CLOSE-OUT PACK"
          reference={data.site.jobReference}
        />

        <View style={{ marginTop: 20 }}>
          <Text style={s.sectionHeading}>Contents</Text>
          <View style={[s.sectionRule, { backgroundColor: brandColour }]} />
          {data.sections.map((sec, i) => (
            <View key={sec.id} style={s.contentsRow}>
              <Text style={s.contentsNum}>{i + 1}.</Text>
              <Text style={s.contentsLabel}>{sec.label}</Text>
            </View>
          ))}
          {data.appendices.length > 0 && (
            <View style={s.contentsRow}>
              <Text style={s.contentsNum}>{data.sections.length + 1}.</Text>
              <Text style={s.contentsLabel}>
                Appendices ({data.appendices.length} document
                {data.appendices.length === 1 ? '' : 's'})
              </Text>
            </View>
          )}
        </View>

        {data.executiveSummary ? (
          <View style={{ marginTop: 26 }}>
            <Text style={s.sectionHeading}>Executive summary</Text>
            <View style={[s.sectionRule, { backgroundColor: brandColour }]} />
            {/* The full disclaimer, once, where the machine prose begins. */}
            <AiNarrative text={data.executiveSummary} full />
          </View>
        ) : null}

        {/*
          SECTIONS FLOW, they do not each claim a page. The HTML pack broke
          before every section, which for a project with eight short sections
          produced ten pages of mostly white paper. `minPresenceAhead` keeps a
          heading with its content instead, so the break happens where the
          content actually runs out.
        */}
        {data.sections.map((sec, i) => (
          <View key={sec.id} style={{ marginTop: 26 }} minPresenceAhead={90}>
            <Text style={s.sectionHeading}>
              {i + 1}. {sec.label}
            </Text>
            <View style={[s.sectionRule, { backgroundColor: brandColour }]} />
            <SectionBody section={sec} />
          </View>
        ))}

        {data.appendices.length > 0 && (
          <View style={{ marginTop: 26 }} break>
            <Text style={s.sectionHeading}>
              {data.sections.length + 1}. Appendices
            </Text>
            <View style={[s.sectionRule, { backgroundColor: brandColour }]} />
            <View style={s.tableHead} fixed>
              <Text style={[s.th, { width: '14%' }]}>REF</Text>
              <Text style={[s.th, { width: '56%' }]}>TITLE</Text>
              <Text style={[s.th, { width: '30%' }]}>SOURCE</Text>
            </View>
            {data.appendices.map((a) => (
              <View key={a.ref} style={s.tableRow} wrap={false}>
                <Text style={[s.td, { width: '14%' }]}>{a.ref}</Text>
                <Text style={[s.td, { width: '56%' }]}>{a.title}</Text>
                <Text style={[s.td, { width: '30%' }]}>{a.source}</Text>
              </View>
            ))}
            <Text style={s.capped}>
              {data.appendicesIncluded
                ? 'Each appendix is included in the originals folder of this archive, named by its reference.'
                : 'The appendices are listed for reference. The files themselves are in the project archive.'}
            </Text>
          </View>
        )}

        <DocumentFooter lines={footer} />
      </Page>
    </Document>
  );
}
