import { ChecklistItemType } from '@prisma/client';
import {
  getCurrentChecklist,
  saveChecklist,
  type ValidatedItem,
} from '@/services/checklists/adminChecklistService';
import { UK_INDUCTION_TEMPLATE } from '@/services/checklists/ukInductionTemplate';

/**
 * Owner Review Item 15 — site PPE requirements, as a first-class thing.
 *
 * PPE already existed and already worked: `PPE_CONFIRM` items on the site's
 * induction checklist, confirmed individually on the "Confirm your PPE" screen
 * and reported on the Compliance tab. What did not exist was any way for a
 * PLATFORM user to see or change them. The only editor was the Admin Centre's
 * generic checklist builder, behind separate Microsoft sign-in, where PPE is one
 * option in a type dropdown. A Director could not reach it at all.
 *
 * So this is a new VIEW onto existing data, not a new store. It reads and writes
 * the same `PPE_CONFIRM` rows, which is what keeps the induction screen,
 * compliance percentages and historic submissions working untouched.
 *
 * VERSIONING IS NOT REIMPLEMENTED HERE. Saving goes through the same
 * `saveChecklist` the Admin builder uses, so the rule stays in one place: edit in
 * place until a worker has checked in against the current version, then publish a
 * new version. A second copy of that rule is how historic check-ins start
 * pointing at content nobody agreed to.
 */

export interface PpeRequirement {
  label: string;
  helpText: string | null;
  required: boolean;
}

/** The PPE offered when a site has none yet — the seeded UK defaults. */
export const DEFAULT_PPE: PpeRequirement[] = UK_INDUCTION_TEMPLATE.filter(
  (i) => i.type === ChecklistItemType.PPE_CONFIRM,
).map((i) => ({
  label: i.label,
  helpText: i.helpText ?? null,
  required: i.required,
}));

const MAX_PPE_ITEMS = 20;

export async function getSitePpeRequirements(
  siteId: string,
): Promise<PpeRequirement[]> {
  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) return [];
  return checklist.items
    .filter((i) => i.type === ChecklistItemType.PPE_CONFIRM)
    .map((i) => ({
      label: i.label,
      helpText: i.helpText,
      required: i.required,
    }));
}

export type SavePpeResult =
  | { ok: true; version: number; newVersion: boolean }
  | { ok: false; error: string };

/**
 * Replace the site's PPE items, leaving every other checklist item alone.
 *
 * The new run is spliced in at the position of the FIRST existing PPE item, not
 * appended. Two reasons: the induction reads in a deliberate order, and the
 * wizard collapses a CONSECUTIVE run of PPE items into one screen — appending
 * would move PPE to the end and, if anything non-PPE followed, split it across
 * two screens.
 */
export async function saveSitePpeRequirements(
  siteId: string,
  input: PpeRequirement[],
): Promise<SavePpeResult> {
  if (!Array.isArray(input)) return { ok: false, error: 'Invalid request.' };
  if (input.length > MAX_PPE_ITEMS) {
    return { ok: false, error: `You can list at most ${MAX_PPE_ITEMS} PPE items.` };
  }

  const cleaned: ValidatedItem[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const label = (item?.label ?? '').trim();
    if (label.length < 2) {
      return { ok: false, error: 'Every PPE item needs a name.' };
    }
    if (label.length > 80) {
      return { ok: false, error: `"${label.slice(0, 30)}…" is too long.` };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `"${label}" is listed twice.` };
    }
    seen.add(key);
    cleaned.push({
      label,
      helpText: (item?.helpText ?? '')?.toString().trim() || null,
      type: ChecklistItemType.PPE_CONFIRM,
      required: item?.required !== false,
    });
  }

  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) {
    return {
      ok: false,
      error: 'This project has no induction checklist yet.',
    };
  }

  const others = checklist.items.filter(
    (i) => i.type !== ChecklistItemType.PPE_CONFIRM,
  );
  if (others.length === 0 && cleaned.length === 0) {
    // saveChecklist refuses an empty checklist, and rightly — an induction with
    // no items is not an induction. Say so in PPE's own words.
    return {
      ok: false,
      error: 'An induction needs at least one item. Add a PPE item, or add other induction items first.',
    };
  }

  const firstPpeIndex = checklist.items.findIndex(
    (i) => i.type === ChecklistItemType.PPE_CONFIRM,
  );
  const asValidated = (i: (typeof others)[number]): ValidatedItem => ({
    label: i.label,
    helpText: i.helpText,
    type: i.type,
    required: i.required,
  });

  let merged: ValidatedItem[];
  if (firstPpeIndex < 0) {
    // No PPE today. Put it after the acknowledgements rather than first: the
    // induction opens by confirming what you were told, then what you wear.
    merged = [...others.map(asValidated), ...cleaned];
  } else {
    const before = checklist.items
      .slice(0, firstPpeIndex)
      .filter((i) => i.type !== ChecklistItemType.PPE_CONFIRM)
      .map(asValidated);
    const after = checklist.items
      .slice(firstPpeIndex)
      .filter((i) => i.type !== ChecklistItemType.PPE_CONFIRM)
      .map(asValidated);
    merged = [...before, ...cleaned, ...after];
  }

  const saved = await saveChecklist(siteId, merged);
  return { ok: true, version: saved.version, newVersion: saved.newVersion };
}
