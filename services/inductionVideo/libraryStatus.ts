/**
 * ONE STATUS VOCABULARY FOR A LIBRARY ASSET.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * The list used to say two things - "Issued · revision 2" or "Not issued — reaches
 * nobody" - and put everything else in a separate draft block underneath. So the
 * commonest real state of all, a live video with a replacement being prepared,
 * could only be understood by reading two places and joining them up. And the
 * Platform and the Admin Centre each phrased it in their own words.
 *
 * The state is DERIVED, never stored. A stored status is a second source of truth
 * that drifts the first time a transcode fails at the wrong moment.
 *
 * No Prisma here on purpose: the index, the detail page and both tiers' components
 * all need this, and a value import from a service that touches the database would
 * pull the client into the browser bundle.
 */

export type LibraryStatusKey =
  | 'NO_FOOTAGE'
  | 'PREPARING'
  | 'PREPARATION_FAILED'
  | 'NEEDS_CAPTIONS'
  | 'READY_TO_ISSUE'
  | 'LIVE'
  | 'LIVE_WITH_DRAFT'
  | 'RETIRED';

export type LibraryStatusTone = 'neutral' | 'working' | 'attention' | 'good' | 'bad';

export interface LibraryStatus {
  key: LibraryStatusKey;
  /** Short enough for a chip. Sentence case, because it is a state not a title. */
  label: string;
  /** What it means and what to do about it. Shown next to the chip, not hidden. */
  detail: string;
  tone: LibraryStatusTone;
  /** Does this asset reach any new induction as things stand? */
  reachesOperatives: boolean;
}

export interface LibraryStatusInput {
  active: boolean;
  issued: { version: number } | null;
  draft: {
    version: number;
    hasFootage: boolean;
    normalised: boolean;
    hasCaptions: boolean;
    normaliseError: string | null;
  } | null;
}

/**
 * RETIRED WINS OVER EVERYTHING, including a live revision: the question a manager is
 * asking is "does this reach anybody", and for a retired asset the answer is no
 * however finished it looks.
 */
export function libraryStatus(a: LibraryStatusInput): LibraryStatus {
  if (!a.active) {
    return {
      key: 'RETIRED',
      label: 'Retired',
      detail: a.issued
        ? `Revision ${a.issued.version} stays on the inductions that already contain it, but no new induction will include this video.`
        : 'No new induction will include this video.',
      tone: 'neutral',
      reachesOperatives: false,
    };
  }

  const d = a.draft;
  // A live asset with work in progress is the common case, and it needs to read as
  // ONE state rather than as a live badge with a separate block to go and find.
  if (a.issued && d) {
    const s = draftStatus(d);
    return {
      key: 'LIVE_WITH_DRAFT',
      label: `Live · revision ${d.version} ${s.shortProgress}`,
      detail:
        `Inductions generated now use revision ${a.issued.version}. ` +
        `Revision ${d.version} ${s.detail}`,
      tone: s.tone === 'bad' ? 'bad' : 'working',
      reachesOperatives: true,
    };
  }
  if (a.issued) {
    return {
      key: 'LIVE',
      label: `Live · revision ${a.issued.version}`,
      detail: 'Every project that has this video switched on includes it.',
      tone: 'good',
      reachesOperatives: true,
    };
  }
  if (!d) {
    return {
      key: 'NO_FOOTAGE',
      label: 'Not started',
      detail: 'No footage yet. This video reaches nobody until a revision is issued.',
      tone: 'neutral',
      reachesOperatives: false,
    };
  }
  const s = draftStatus(d);
  return {
    key: s.key,
    label: s.label,
    detail: `${s.detail} Until it is issued, this video reaches nobody.`,
    tone: s.tone,
    reachesOperatives: false,
  };
}

function draftStatus(d: NonNullable<LibraryStatusInput['draft']>): {
  key: LibraryStatusKey;
  label: string;
  shortProgress: string;
  detail: string;
  tone: LibraryStatusTone;
} {
  if (!d.hasFootage) {
    return {
      key: 'NO_FOOTAGE',
      label: 'Needs footage',
      shortProgress: 'needs footage',
      detail: 'has no video file yet.',
      tone: 'neutral',
    };
  }
  if (d.normaliseError) {
    return {
      key: 'PREPARATION_FAILED',
      label: 'Preparation failed',
      shortProgress: 'failed to prepare',
      detail: `could not be prepared: ${d.normaliseError}`,
      tone: 'bad',
    };
  }
  if (!d.normalised) {
    return {
      key: 'PREPARING',
      label: 'Preparing',
      shortProgress: 'being prepared',
      detail:
        'is being converted to the induction format. This takes a few minutes for a ' +
        'long video; the page updates itself.',
      tone: 'working',
    };
  }
  if (!d.hasCaptions) {
    return {
      key: 'NEEDS_CAPTIONS',
      label: 'Needs captions',
      shortProgress: 'needs captions',
      detail:
        'still needs a caption file. Without one the finished induction has no ' +
        'subtitles for this section.',
      tone: 'attention',
    };
  }
  return {
    key: 'READY_TO_ISSUE',
    label: 'Ready to issue',
    shortProgress: 'ready to issue',
    detail: 'is ready. Issuing it makes it the version every project uses.',
    tone: 'good',
  };
}

/** Every state, for a filter control. Ordered as a lifecycle, not alphabetically. */
export const LIBRARY_STATUS_FILTERS: { key: LibraryStatusKey; label: string }[] = [
  { key: 'NO_FOOTAGE', label: 'Not started / needs footage' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'PREPARATION_FAILED', label: 'Preparation failed' },
  { key: 'NEEDS_CAPTIONS', label: 'Needs captions' },
  { key: 'READY_TO_ISSUE', label: 'Ready to issue' },
  { key: 'LIVE', label: 'Live' },
  { key: 'LIVE_WITH_DRAFT', label: 'Live, replacement in progress' },
  { key: 'RETIRED', label: 'Retired' },
];
