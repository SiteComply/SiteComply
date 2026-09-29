/**
 * ONE STATUS VOCABULARY FOR A COMPANY MODULE.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * The modules list said one of two things - "Issued · revision 1" or "Not issued —
 * reaches nobody" - and put the draft in a separate line underneath. So the state
 * that matters most while somebody is working, LIVE WITH A DRAFT BEING PREPARED,
 * could only be read by joining two places up. The Library hit the same problem and
 * solved it this way; this is the same shape for the same reason, so the two areas
 * describe themselves in one vocabulary.
 *
 * The state is DERIVED, never stored. A stored status is a second source of truth,
 * and it drifts the first moment somebody issues a revision in the other tier.
 *
 * ── THE LABEL SAYS WHETHER ANYBODY HEARS IT ───────────────────────────────
 *
 * It used to say "Issued · rev 1" with a separate "Reaches nobody" line underneath
 * for the states that were not issued, which meant the row carried two facts that had
 * to be joined up, and the second was phrased in a way a first-time user had to
 * decode. So the label itself now carries it - "Live", or "Draft · rev 2 — not live" -
 * and nothing else on the row needs to repeat it. The vocabulary matches the
 * Library's on purpose: one area, one set of words.
 *
 * No Prisma here on purpose: the list, the detail page and both tiers all need
 * this, and a value import from a service that touches the database would pull the
 * client into the browser bundle - a mistake that has already reached production in
 * this codebase once.
 */

export type ModuleStatusKey =
  | 'NOTHING_WRITTEN'
  | 'DRAFT_ONLY'
  | 'LIVE'
  | 'LIVE_WITH_DRAFT'
  | 'RETIRED';

export type ModuleStatusTone = 'neutral' | 'working' | 'attention' | 'good';

export interface ModuleStatus {
  key: ModuleStatusKey;
  /** Short enough for a chip in a table cell. */
  label: string;
  /** What it means and what to do about it. For the detail page, not the row. */
  detail: string;
  tone: ModuleStatusTone;
  /** Does this module reach any new induction as things stand? */
  reachesOperatives: boolean;
}

export interface ModuleStatusInput {
  active: boolean;
  /** The revision in force, if any. */
  issued: { version: number } | null;
  /** An unissued revision being worked on, if any. */
  draft: { version: number } | null;
}

export function moduleStatus(input: ModuleStatusInput): ModuleStatus {
  /*
   * RETIRED FIRST. A retired module reaches nobody whatever is issued on it, so
   * asking about revisions before activity would describe a module as live when it
   * is not in any induction.
   */
  if (!input.active) {
    return {
      key: 'RETIRED',
      label: 'Retired',
      detail:
        'Kept for history and left out of every induction. Bring it back to use it again.',
      tone: 'neutral',
      reachesOperatives: false,
    };
  }

  if (input.issued && input.draft) {
    return {
      key: 'LIVE_WITH_DRAFT',
      label: `Live · rev ${input.issued.version} (rev ${input.draft.version} draft)`,
      detail:
        `Revision ${input.issued.version} is what operatives hear. Revision ` +
        `${input.draft.version} is being written and reaches nobody until it is issued.`,
      tone: 'working',
      reachesOperatives: true,
    };
  }

  if (input.issued) {
    return {
      key: 'LIVE',
      label: `Live · rev ${input.issued.version}`,
      detail: `Revision ${input.issued.version} is in force and included in inductions.`,
      tone: 'good',
      reachesOperatives: true,
    };
  }

  /*
   * A DRAFT REACHES NOBODY, and saying so is the whole point of this state. It is
   * the condition that let a "Company Introduction" module sit in production reading
   * "REPLACE THIS TEXT BEFORE ISSUING" while looking, on a list, much like the
   * issued ones next to it.
   */
  if (input.draft) {
    return {
      key: 'DRAFT_ONLY',
      label: `Draft · rev ${input.draft.version} — not live`,
      detail:
        'Never issued, so it reaches nobody. Read it through and issue it when the ' +
        'wording is right.',
      tone: 'attention',
      reachesOperatives: false,
    };
  }

  return {
    key: 'NOTHING_WRITTEN',
    label: 'Not started',
    detail: 'No wording yet. Write it, then issue it to put it into inductions.',
    tone: 'neutral',
    reachesOperatives: false,
  };
}
