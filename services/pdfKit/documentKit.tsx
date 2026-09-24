import React from 'react';
import path from 'path';
import { Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';

/**
 * The shared chrome of a SiteComply document.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The construction phase plan and the induction record each grew their own
 * masthead, their own font registration and their own page-numbered footer. The
 * permit made three. Every copy is a chance for one document to drift out of
 * the family, and - worse - every copy is a chance to rediscover the same
 * engine traps the hard way, which is exactly what happened when the permit was
 * written.
 *
 * So the chrome lives here once, with the traps closed by construction rather
 * than by memory.
 *
 * ── THE TRAPS, CLOSED HERE ────────────────────────────────────────────────
 *
 *  1. A unitless `lineHeight` anywhere in the chain of a `render`-prop element
 *     makes it resolve to NOTHING. No page numbers, no error. So no style in
 *     this file sets one, and `pageStyle()` does not put one on the Page.
 *  2. An ABSOLUTELY POSITIONED footer renders perfectly in isolation and prints
 *     nothing at all on a full page. The footer here is pushed down with
 *     `marginTop: 'auto'` and carries its rule as its own border.
 *  3. The page-number Text needs an EXPLICIT WIDTH: in a flex row whose left
 *     cell is `flex: 1` it is otherwise squeezed to nothing and prints empty.
 *  4. WOFF2 faces read fine and then cannot be embedded, dying inside pdfkit.
 *     Only WOFF is registered.
 *
 * Each of those produced a plausible document with something silently missing,
 * and each was found by LOOKING at a rendered page rather than by a test.
 */

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

export const DOC = {
  ink: '#1A1D21',
  inkMuted: '#5B6570',
  inkSubtle: '#8A929B',
  rule: '#D8DDE2',
  green: '#2E8B3F',
  red: '#B3261E',
  amber: '#8A6A0B',
} as const;

let registered = false;

/**
 * Register the document faces. Idempotent, and safe to call per render.
 *
 * The faces are COMMITTED to the repository rather than resolved from
 * node_modules: a document whose appearance depends on the install tree is not
 * a controlled document. See assets/fonts/README.md.
 */
export function registerDocumentFonts(): void {
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
  // A reference, a postcode or a job number broken across a line stops being
  // quotable, which is most of what a reader does with them.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** The Page style. NO lineHeight — see trap 1. */
export function pageStyle(overrides: Record<string, unknown> = {}) {
  return {
    fontFamily: 'SourceSans3',
    fontSize: 9.5,
    color: DOC.ink,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 46,
    ...overrides,
  };
}

const s = StyleSheet.create({
  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: { height: 26, marginBottom: 4, objectFit: 'contain' },
  companyName: { fontSize: 11, fontWeight: 700 },
  tagline: { fontSize: 8, color: DOC.inkSubtle },
  docTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 1.1, textAlign: 'right' },
  docRef: {
    fontSize: 9,
    color: DOC.inkMuted,
    textAlign: 'right',
    marginTop: 2,
    fontWeight: 600,
  },
  brandRule: { height: 2, marginTop: 10 },

  footer: {
    // Trap 2: pushed down, never positioned absolutely.
    marginTop: 'auto',
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: DOC.rule,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  footerLeft: { flex: 1 },
  // Trap 1: no lineHeight here, ever.
  footerText: { fontSize: 7.5, color: DOC.inkSubtle },
  // Trap 3: an explicit width, or the page number collapses to nothing.
  footerRight: { width: 92, textAlign: 'right' },

  block: { marginTop: 10, paddingTop: 8 },
  rule: { borderBottomWidth: 0.75, borderBottomColor: DOC.rule },
  sectionLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.2,
    marginBottom: 6,
    color: DOC.inkSubtle,
  },
  fact: { flexDirection: 'row', marginTop: 2 },
  factLabel: { width: 96, fontSize: 9.5, color: DOC.inkSubtle },
  factValue: { flex: 1, fontSize: 9.5, color: DOC.inkMuted, lineHeight: 1.45 },
});

export interface DocumentBrand {
  name: string;
  tagline: string | null;
  primaryColor: string;
  logo: { bytes: Buffer; contentType: string } | null;
}

/**
 * The top of every page.
 *
 * Rendered inside a `fixed` View by the caller so a second page carries it:
 * a reader who is handed page four of a document should be able to tell what
 * document it is.
 */
export function Masthead({
  brand,
  title,
  reference,
}: {
  brand: DocumentBrand;
  title: string;
  reference?: string | null;
}) {
  return (
    <View fixed>
      <View style={s.masthead}>
        <View>
          {brand.logo ? <Image style={s.logo} src={brand.logo.bytes} /> : null}
          <Text style={s.companyName}>{brand.name}</Text>
          {brand.tagline ? <Text style={s.tagline}>{brand.tagline}</Text> : null}
        </View>
        <View>
          <Text style={s.docTitle}>{title}</Text>
          {reference ? <Text style={s.docRef}>{reference}</Text> : null}
        </View>
      </View>
      <View style={[s.brandRule, { backgroundColor: brand.primaryColor || '#00AEEF' }]} />
    </View>
  );
}

/**
 * The foot of every page, with working pagination.
 *
 * The page-number Text is a DIRECT CHILD of the fixed element: nested one level
 * deeper, every other footer line prints and the page number silently does not.
 */
export function DocumentFooter({ lines }: { lines: string[] }) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerLeft}>
        {lines.map((l, i) => (
          <Text key={i} style={s.footerText}>
            {l}
          </Text>
        ))}
      </View>
      <Text
        style={[s.footerText, s.footerRight]}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

/**
 * A titled block.
 *
 * `minPresenceAhead` is this engine's "keep with next": a heading with less than
 * that much room under it moves to the next page rather than sitting alone at
 * the foot of this one.
 */
export function Section({
  title,
  children,
  keepAhead = 56,
}: {
  title: string;
  children: React.ReactNode;
  keepAhead?: number;
}) {
  return (
    <View style={s.block} minPresenceAhead={keepAhead}>
      <View style={s.rule} />
      <View style={{ paddingTop: 8 }}>
        <Text style={s.sectionLabel}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────── dates, one way ─────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Europe/London, always.
 *
 * These documents record when things happened on British sites. A server that
 * formatted in UTC would print an hour early for half the year, on exactly the
 * fields a reader relies on.
 */
function parts(d: Date) {
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

export function longDate(d: Date): string {
  const p = parts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}
export function longDateTime(d: Date): string {
  const p = parts(d);
  return `${longDate(d)} at ${p.hh}:${p.mm}`;
}
/** "08:42" — the time alone, still in site time. */
export function timeOnly(d: Date): string {
  const p = parts(d);
  return `${p.hh}:${p.mm}`;
}

export function shortDateTime(d: Date): string {
  const p = parts(d);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year} ${p.hh}:${p.mm}`;
}

export const kitStyles = s;
