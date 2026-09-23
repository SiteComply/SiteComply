/**
 * SC-001 — the CSCS Smart Check card schemes an operative can choose from.
 *
 * ONE PLACE. The onboarding picker, the admin editor and the lookup all read
 * this, so a scheme exists once or not at all.
 *
 * TRANSCRIBED EXACTLY AS SUPPLIED. These ids are externally defined identifiers
 * issued by CSCS, and the names are the schemes' own. Neither is ours to tidy,
 * abbreviate or re-case: a single wrong character produces a lookup that fails
 * and an operative told their valid card was not found.
 *
 * LETTER O VERSUS DIGIT ZERO. Both appear in this list — 62O and LO7 carry the
 * letter, 3W0 carries the digit — and the two are indistinguishable in most
 * sans-serif type. A single confusion here fails silently: the lookup returns
 * "not found" and the worker is told a valid card was not recognised. If any of
 * OUQ, ROT, 62O, 3W0 or LO7 was mis-transcribed at any point in the chain, this
 * is the line to check first.
 *
 * ORDER IS THE ORDER SUPPLIED for the original seventeen, with ECS inserted
 * after CSCS (see below). Not alphabetical. It may encode prevalence —
 * CSCS itself is first, and covers the large majority of UK construction — and
 * reordering someone else's list on a guess is not an improvement. Sorting is a
 * one-line change if it reads better on a phone.
 */

export interface CscsScheme {
  /** The identifier Smart Check expects in the lookup. Never shown to a worker. */
  id: string;
  /** What the worker sees. The scheme's own name, spelled their way. */
  name: string;
}

export const CSCS_SCHEMES: CscsScheme[] = [
  { id: 'C4T', name: 'CSCS' },
  /*
   * ECS, from the Smart Check Supported Schemes documentation (2026-09-23).
   *
   * TWO SCHEMES, TWO IDENTIFIERS: the JIB runs ECS in England, Wales and
   * Northern Ireland; the SJIB runs it in Scotland. A holder must pick their
   * own - the other returns "no matching card".
   *
   * PLACED SECOND AND THIRD rather than appended. The rest of the list is in
   * the order supplied, which appears to run by prevalence; ECS is the card
   * most electricians hold, and burying it under fifteen schemes they do not
   * hold is how someone picks the wrong one. NOT part of the original
   * seventeen - see the transcription test, which pins this order too.
   */
  { id: 'ECS', name: 'ECS (JIB)' },
  { id: 'CFW', name: 'ECS (SJIB)' },
  { id: 'OUQ', name: 'JIB PMES' },
  { id: 'Z2T', name: 'ECITB ACE' },
  { id: '9ZA', name: 'BESA' },
  { id: 'ROT', name: 'IPAF' },
  { id: 'R7S', name: 'PASMA' },
  { id: 'HEZ', name: 'EUSR' },
  { id: 'P5Y', name: 'NPORS' },
  { id: '4UC', name: 'Lantra TTM' },
  { id: 'JHW', name: 'AMI' },
  { id: 'U19', name: 'ALLMI' },
  { id: 'MRD', name: 'TICA' },
  { id: 'WKN', name: 'ACAD' },
  { id: '62O', name: 'GEA' },
  { id: 'WP8', name: 'ICATS' },
  { id: '3W0', name: 'CSR' },
  { id: 'LO7', name: 'ADSA DHF' },
];

/**
 * Whether the list above is the FULL documented set.
 *
 * False: it was supplied as "at a minimum", so more schemes may exist. That does
 * not stop the picker working — nineteen is a real choice where one was not —
 * but it does mean a worker may hold a card whose scheme is absent, and the form
 * has to say what to do about that rather than leave them stuck on a required
 * field with no correct answer.
 */
export const SCHEME_LIST_EXHAUSTIVE = false;

/**
 * Whether a scheme can be asked of an operative.
 *
 * Distinct from exhaustive on purpose. A single-entry menu implies the others do
 * not exist and is worse than no menu; a list of nineteen is worth offering
 * even while more may be missing.
 */
export function schemesAreUsable(): boolean {
  return CSCS_SCHEMES.length > 1;
}

/**
 * The operative's answer when their scheme is not on the list.
 *
 * A DELIBERATE ANSWER, not a blank. The list holds 19 of the 38 CSCS Alliance
 * schemes (both ECS schemes included since 2026-09-23), so a holder of one of
 * the other 19 still has no correct option. Requiring a choice from the list forced them to name a scheme that
 * did not issue their card, and the lookup then answered "no matching card":
 * a valid card reported as a bad one, and a wrong scheme stored against them.
 *
 * Chosen here, the card is recorded and honestly left unverified until the
 * scheme can be checked. STORED, so the record keeps the difference between
 * "told us their scheme is not on the list" and "has not answered yet": the
 * first is nothing the operative can fix, the second is. Never sent to Smart
 * Check - every lookup path asks isKnownScheme first.
 */
export const SCHEME_NOT_LISTED = 'NOT_LISTED';

export function isSchemeNotListed(id: string | null | undefined): boolean {
  return (id ?? '').trim().toUpperCase() === SCHEME_NOT_LISTED;
}

/** Look one up. Returns undefined for an id we do not know. */
export function schemeById(id: string | null | undefined): CscsScheme | undefined {
  if (!id) return undefined;
  return CSCS_SCHEMES.find((s) => s.id === id);
}

/** True when the id is one we recognise. Used before a lookup is attempted. */
export function isKnownScheme(id: string | null | undefined): boolean {
  return schemeById(id) !== undefined;
}
