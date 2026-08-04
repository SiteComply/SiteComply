/**
 * SC-017 FOLLOW-UP — one photo, not two.
 *
 * SC-017 stores an annotated photo as its own row linked back to the untouched
 * original (`originalEvidenceId`), so an audit record always retains what the
 * camera actually captured. That is the right storage model and it is unchanged.
 *
 * What was wrong was the PRESENTATION of it: both rows were attached, listed,
 * counted and packed, so every annotated photo appeared twice — in the evidence
 * gallery, in the close-out pack, in the pack's public share link and in the
 * archived ZIP, where it also consumed two of the pack's capped photo slots for
 * one piece of evidence.
 *
 * An original that has been annotated is now SUPERSEDED: the annotated copy is
 * the evidence, and the original is retained for audit but kept out of normal
 * viewing and reporting.
 *
 * DERIVED, NOT STORED — deliberately:
 *
 *  - It applies retrospectively to photos annotated before this change, with no
 *    migration and no backfill.
 *  - It self-heals. Delete the annotated copy and its original stops being
 *    superseded and reappears, because the rule asks whether a surviving
 *    annotated row points at it. A stored flag would leave the original hidden
 *    forever — evidence that exists but nobody can see.
 *  - There is no second source of truth to drift from the link itself.
 *
 * Nothing here deletes, alters or hides anything at rest: every original keeps
 * its row, its blob and its uploader and timestamp.
 */

/** The minimum an evidence row must expose to take part in the rule. */
export interface AnnotationLinkable {
  id: string;
  annotated: boolean;
  originalEvidenceId: string | null;
}

/**
 * Ids of originals that a surviving annotated copy points at, within `rows`.
 *
 * Scoped to the rows given, which is what makes it usable both for one finding's
 * gallery and for a whole site's pack — the caller decides the population.
 */
export function supersededOriginalIds(rows: AnnotationLinkable[]): Set<string> {
  const present = new Set(rows.map((r) => r.id));
  const ids = new Set<string>();
  for (const r of rows) {
    // `annotated` alone is not enough: an annotated copy whose original was
    // deleted has a dangling id, and marking that id would hide nothing while
    // implying something is still there.
    if (
      r.annotated &&
      r.originalEvidenceId &&
      present.has(r.originalEvidenceId)
    ) {
      ids.add(r.originalEvidenceId);
    }
  }
  return ids;
}

/**
 * Tag each row with whether it is a superseded original.
 *
 * Returns every row, tagged — it never drops one. Deciding what to do with a
 * superseded original is the caller's job: the gallery keeps it behind a
 * disclosure, the close-out pack leaves it out entirely.
 */
export function markSuperseded<T extends AnnotationLinkable>(
  rows: T[],
): (T & { supersededOriginal: boolean })[] {
  const superseded = supersededOriginalIds(rows);
  return rows.map((r) => ({ ...r, supersededOriginal: superseded.has(r.id) }));
}
