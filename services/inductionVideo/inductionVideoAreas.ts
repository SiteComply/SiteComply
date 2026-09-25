/**
 * THE INDUCTION VIDEO AREA, DEFINED ONCE FOR BOTH TIERS.
 *
 * Induction videos appear in two places — the Platform and the Admin Centre —
 * and they are the same product seen twice, not two features that happen to look
 * alike. So the areas, their order, their labels and their wording live HERE, and
 * both tiers render from this list.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 *
 * The Admin Centre first got company modules as a Settings item with its own
 * heading and its own words. Functionally complete, and wrong: it read as a
 * miscellaneous setting rather than part of the induction video product, and
 * nothing connected it to the Platform's structure. Two hand-maintained copies of
 * one information architecture drift on the first change — someone renames
 * "Company modules" in one tier and the other keeps the old word forever.
 *
 * Adding an area here makes it appear in BOTH tiers. That is the point.
 *
 * ── PRESENTATION ONLY ─────────────────────────────────────────────────────
 *
 * No permission is evaluated here and no route is guarded. Each tier decides
 * which areas a given viewer may see, and every page keeps its own gate. A
 * navigator that hides a link is not an access control.
 */

export type InductionVideoAreaKey = 'sites' | 'modules' | 'library';

export interface InductionVideoArea {
  key: InductionVideoAreaKey;
  label: string;
  description: string;
  /*
   * There is deliberately no `adminReadOnly` flag any more.
   *
   * It existed for one day and encoded the wrong rule: that videos were
   * generated, approved and published only by a Platform user. The owner's
   * decision is that an Admin Centre OWNER or ADMIN has authority equivalent to a
   * Platform Director for induction video management - generation, editing,
   * approval, narration, rendering, publishing, withdrawal, regeneration and
   * version management - across every project. Both areas are fully actionable in
   * both tiers, so a per-area capability flag would have exactly one value and
   * would only invite the restriction back.
   *
   * What a given PERSON may do is answered by videoActor.ts and moduleActor.ts,
   * where each realm's roles are known. An admin VIEWER is read-only in both
   * areas; that is a role, not a property of the area.
   */
}

export const INDUCTION_VIDEO_AREAS: InductionVideoArea[] = [
  {
    /*
     * "SITES", NOT "VIDEOS". This tab lists PROJECTS - which have an induction
     * video, which are waiting on someone, which have never been started - and
     * calling it Videos described the feature rather than the content, inside an
     * area already called Induction videos. The route is unchanged: the area's
     * landing page is still /induction-videos, because the URL is load-bearing
     * and the word in it names the area, not this tab.
     */
    key: 'sites',
    label: 'Sites',
    description:
      'One row per project: which have an induction video, which are waiting on you, and which are missing information.',
  },
  {
    /*
     * Second, not first: a manager opens this area to work on a project's video,
     * and company content is what that video is partly built FROM. Putting the
     * company standard first would make the daily task the secondary one - and
     * the ordering is shared, so both tiers agree about that.
     */
    key: 'modules',
    label: 'Company modules',
    description:
      'Standard content every induction carries, written once and issued centrally — included in every project alongside its own hazards and arrangements.',
  },
  {
    /*
     * THIRD, because it is the least often touched and the most expensive to
     * change: footage is commissioned, filmed and uploaded, not typed. Modules and
     * the Library are both reusable company content - the difference is that one is
     * words the voice speaks and the other is a finished film - so they sit next to
     * each other, after the daily work.
     */
    key: 'library',
    label: 'Library',
    description:
      'Approved company video segments — an introduction, PPE, behavioural standards — inserted into every project’s induction alongside its generated scenes.',
  },
];

/** What the area is called wherever it is linked to or titled. */
export const INDUCTION_VIDEO_AREA_TITLE = 'Induction videos';

const BASE: Record<'PLATFORM' | 'ADMIN', string> = {
  PLATFORM: '/platform/dashboard/induction-videos',
  ADMIN: '/admin/induction-videos',
};

/**
 * Where an area lives in a given tier.
 *
 * The two tiers differ only in their prefix, deliberately: the same area sits at
 * the same relative path in both, so a path in one tier can be read across to the
 * other without a lookup table.
 */
export function inductionVideoHref(
  tier: 'PLATFORM' | 'ADMIN',
  key: InductionVideoAreaKey,
): string {
  // 'sites' IS the area's landing page rather than a child of it, so it has no
  // path segment of its own. Renaming the tab did not move the URL.
  return key === 'sites' ? BASE[tier] : `${BASE[tier]}/${key}`;
}

export function inductionVideoAreaBase(tier: 'PLATFORM' | 'ADMIN'): string {
  return BASE[tier];
}
