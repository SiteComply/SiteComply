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

export type InductionVideoAreaKey = 'videos' | 'modules';

export interface InductionVideoArea {
  key: InductionVideoAreaKey;
  label: string;
  description: string;
  /**
   * True when the Admin Centre can only SHOW this area, not act on it.
   *
   * Videos are generated, approved and published against a project by a Platform
   * user, and that is where the work belongs; an admin can see the state of every
   * project's induction video without being given a second way to approve one.
   * Company modules are fully manageable in both tiers.
   */
  adminReadOnly: boolean;
}

export const INDUCTION_VIDEO_AREAS: InductionVideoArea[] = [
  {
    key: 'videos',
    label: 'Videos',
    description:
      'One row per project: which have an induction video, which are waiting on you, and which are missing information.',
    adminReadOnly: true,
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
    adminReadOnly: false,
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
  return key === 'videos' ? BASE[tier] : `${BASE[tier]}/${key}`;
}

export function inductionVideoAreaBase(tier: 'PLATFORM' | 'ADMIN'): string {
  return BASE[tier];
}
