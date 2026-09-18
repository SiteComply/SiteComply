import { ChecklistItemType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getCurrentChecklist,
  saveChecklist,
  type ValidatedItem,
} from '@/services/checklists/adminChecklistService';
import {
  UK_SITE_RULES_LIBRARY,
  UK_SITE_RULES_DEFAULT,
} from '@/services/checklists/ukSiteRulesLibrary';
import { isSiteRulesAck } from '@/services/checklists/inductionFlow';
import { siteRulesChanged } from '@/services/checklists/siteRuleRows';
import type {
  SiteRule,
  LibraryRule,
} from '@/services/checklists/siteRuleRows';

/**
 * Site Rules Library — the rules an operative is shown during induction.
 *
 * Built exactly like sitePpeService: a new VIEW onto the site's existing
 * versioned checklist, not a new store. A rule is a `SITE_RULE` checklist item,
 * so it gets versioning, ordering and snapshot-on-use for free — and, crucially,
 * a historic check-in still points at the rules that were actually on screen when
 * that person agreed to them. That is the whole reason not to keep rules in a
 * column on the site: a site's rules change, and a signed acknowledgement that
 * silently follows them is worth nothing.
 *
 * WHAT A RULE IS NOT: a tick. Rules are displayed beneath the single
 * "I have read and will follow the site rules and signage." acknowledgement and
 * covered by it. Nothing here is answered, which is why `required` is forced to
 * false on every row — see buildInductionSteps, which never gives a rule a screen
 * or an answer key.
 *
 * The free-text `SiteInformation.siteRules` field is a DIFFERENT thing and is
 * deliberately left alone: it is reference material on the Site information page,
 * readable any time, not the induction rule set. Two fields, two jobs.
 */

/**
 * The pure shapes and the editor's row logic live in `siteRuleRows`, which
 * imports nothing server-only, and are re-exported here so server-side callers
 * have one place to look. The split exists because the Site rules editor is a
 * CLIENT component: a value imported from this file reaches lib/prisma and
 * breaks the browser build. See siteRuleRows for the full note.
 */
export {
  buildRuleRows,
  siteRulesChanged,
  type SiteRule,
  type LibraryRule,
  type RuleRow,
} from '@/services/checklists/siteRuleRows';

/**
 * The WHOLE library offered in the editor — both tiers.
 *
 * The optional templates appear as unticked rows a Site Manager can tick on.
 * That needs no new mechanism: an unticked row already means "not shown at
 * induction", which is exactly what an unadopted template is.
 */
export const SITE_RULE_LIBRARY: LibraryRule[] = UK_SITE_RULES_LIBRARY.map((r) => ({
  label: r.label,
  helpText: r.helpText ?? null,
  defaultSelected: r.defaultSelected,
}));

/** Just the universal tier — what a NEW site is seeded with. */
export const DEFAULT_SITE_RULES: SiteRule[] = UK_SITE_RULES_DEFAULT.map((r) => ({
  label: r.label,
  helpText: r.helpText ?? null,
}));

/** Labels in the library, for telling a library rule from a custom one. */
const LIBRARY_LABELS = new Set(
  UK_SITE_RULES_LIBRARY.map((r) => r.label.trim().toLowerCase()),
);

export function isLibraryRule(label: string): boolean {
  return LIBRARY_LABELS.has(label.trim().toLowerCase());
}

/** Whether a label is an OPTIONAL template rather than a universal default. */
const OPTIONAL_LABELS = new Set(
  UK_SITE_RULES_LIBRARY.filter((r) => !r.defaultSelected).map((r) =>
    r.label.trim().toLowerCase(),
  ),
);

export function isOptionalTemplateRule(label: string): boolean {
  return OPTIONAL_LABELS.has(label.trim().toLowerCase());
}

const MAX_RULES = 40;
const MAX_RULE_LENGTH = 200;

export async function getSiteRules(siteId: string): Promise<SiteRule[]> {
  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) return [];
  return checklist.items
    .filter((i) => i.type === ChecklistItemType.SITE_RULE)
    .map((i) => ({ label: i.label, helpText: i.helpText }));
}

/**
 * Whether the induction still carries the acknowledgement that covers the rules.
 *
 * Surfaced to the editor rather than enforced. A site is allowed to have reworded
 * or removed that statement — but somebody publishing fifteen rules deserves to
 * know whether anyone is agreeing to them, and this is the only place that fact
 * is visible.
 */
export async function siteRulesAreAcknowledged(siteId: string): Promise<boolean> {
  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) return false;
  return checklist.items.some(isSiteRulesAck);
}

export type SaveSiteRulesResult =
  | { ok: true; version: number; newVersion: boolean }
  | { ok: false; error: string };

export type ValidateSiteRulesResult =
  | { ok: true; items: ValidatedItem[] }
  | { ok: false; error: string };

/**
 * Validate and normalise submitted rules. Pure, and exported so the rules that
 * matter most — a rule is never required, a rule is never a duplicate — can be
 * proven without a database.
 */
export function validateSiteRules(input: SiteRule[]): ValidateSiteRulesResult {
  if (!Array.isArray(input)) return { ok: false, error: 'Invalid request.' };
  if (input.length > MAX_RULES) {
    return { ok: false, error: `You can list at most ${MAX_RULES} site rules.` };
  }

  const items: ValidatedItem[] = [];
  const seen = new Set<string>();
  for (const rule of input) {
    const label = (rule?.label ?? '').trim();
    if (label.length < 3) {
      return { ok: false, error: 'Every site rule needs some wording.' };
    }
    if (label.length > MAX_RULE_LENGTH) {
      return {
        ok: false,
        error: `"${label.slice(0, 30)}…" is too long. Keep a rule under ${MAX_RULE_LENGTH} characters.`,
      };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `"${label}" is listed twice.` };
    }
    seen.add(key);
    items.push({
      label,
      helpText: (rule?.helpText ?? '')?.toString().trim() || null,
      type: ChecklistItemType.SITE_RULE,
      // Never required: a rule is read, not answered. Forced here rather than
      // taken from the caller so no future editor, and no hand-made API call, can
      // create a rule that gates a screen nobody can pass.
      required: false,
    });
  }
  return { ok: true, items };
}

/** A checklist item, as far as the merge below is concerned. */
export interface MergeableItem {
  label: string;
  helpText: string | null;
  type: ChecklistItemType;
  required: boolean;
}

/**
 * Splice a new run of rules into a checklist, dropping the old run.
 *
 * Position: where the rules already are; failing that, immediately after the
 * acknowledgement that covers them; failing that, the end. The induction reads in
 * order, and rules below the safe-working agreement are rules nobody connects to
 * the tick they made three screens earlier.
 *
 * Pure, and exported, so the placement can be proven without a database.
 */
export function mergeRuleItems(
  existing: MergeableItem[],
  rules: ValidatedItem[],
): ValidatedItem[] {
  const isRule = (i: { type: ChecklistItemType }) =>
    i.type === ChecklistItemType.SITE_RULE;
  const others = existing.filter((i) => !isRule(i));

  const firstRuleIndex = existing.findIndex(isRule);
  const insertAt =
    firstRuleIndex >= 0
      ? // How many non-rule items precede it — that is its index within `others`.
        existing.slice(0, firstRuleIndex).filter((i) => !isRule(i)).length
      : (() => {
          const ackIndex = others.findIndex(isSiteRulesAck);
          return ackIndex >= 0 ? ackIndex + 1 : others.length;
        })();

  const kept: ValidatedItem[] = others.map((i) => ({
    label: i.label,
    helpText: i.helpText,
    type: i.type,
    required: i.required,
  }));
  return [...kept.slice(0, insertAt), ...rules, ...kept.slice(insertAt)];
}

/**
 * Replace the site's rules, leaving every other checklist item alone.
 *
 * Spliced in at the position of the FIRST existing rule, not appended — the same
 * reasoning as PPE. The induction reads in order, and the rules belong directly
 * under the acknowledgement that refers to them; appending would drop them below
 * the safe-working agreement, where nobody connects them to the tick they made
 * three screens ago.
 *
 * For a site whose checklist has no rules yet, they go immediately AFTER the
 * site-rules acknowledgement, which is the same place for the same reason.
 */
export async function saveSiteRules(
  siteId: string,
  input: SiteRule[],
): Promise<SaveSiteRulesResult> {
  const validated = validateSiteRules(input);
  if (!validated.ok) return { ok: false, error: validated.error };

  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) {
    return { ok: false, error: 'This project has no induction checklist yet.' };
  }

  const others = checklist.items.filter(
    (i) => i.type !== ChecklistItemType.SITE_RULE,
  );
  if (others.length === 0) {
    // saveChecklist refuses an empty checklist, and rightly. Rules alone are not
    // an induction — there would be nothing to acknowledge them.
    return {
      ok: false,
      error:
        'An induction needs at least one item to acknowledge. Add induction items before adding site rules.',
    };
  }

  const merged = mergeRuleItems(checklist.items, validated.items);

  const saved = await saveChecklist(siteId, merged);
  return { ok: true, version: saved.version, newVersion: saved.newVersion };
}

// ---------------------------------------------------------------------------
// The operative's post-induction view
// ---------------------------------------------------------------------------

/**
 * The site's rules as an operative reviews them AFTER induction, on Site
 * information.
 *
 * WHY LIVE RULES AND NOT THE SNAPSHOT THEY SIGNED.
 *
 * The rules that matter to somebody standing on a site are the ones in force
 * now. Showing the signed snapshot would let an operative read a superseded rule
 * and believe they were current — the one failure mode this screen exists to
 * prevent. So the list is live, exactly like every other section of Site
 * information.
 *
 * That trades against honesty about what they agreed to, which is why the
 * acknowledgement travels with it: when they agreed, and whether the rules have
 * moved since. They get the current rules AND the truth about their signature,
 * rather than one at the cost of the other.
 *
 * `changedSinceInduction` compares the RULE TEXT of the version they answered
 * against the rule text in force, NOT the checklist version number. A checklist
 * is re-versioned by any edit — a PPE item, a reworded question — and telling an
 * operative their site rules had changed because somebody added a hard-hat row
 * would be a false alarm, and false alarms are how a real change gets ignored.
 */
export interface WorkerSiteRulesView {
  /** The rules in force now, in induction order. */
  rules: SiteRule[];
  /** When this worker last completed an induction here. Null if never. */
  acknowledgedAt: Date | null;
  /**
   * True when the rule text in force differs from the set this worker actually
   * acknowledged. False when they match, and false when there is nothing to
   * compare against — an unknown is not a change.
   */
  changedSinceInduction: boolean;
}

function rulesOf(items: { type: ChecklistItemType; label: string; helpText: string | null }[]): SiteRule[] {
  return items
    .filter((i) => i.type === ChecklistItemType.SITE_RULE)
    .map((i) => ({ label: i.label, helpText: i.helpText }));
}

export async function getSiteRulesForWorker(
  siteId: string,
  workerId: string,
): Promise<WorkerSiteRulesView> {
  const checklist = await getCurrentChecklist(siteId);
  const rules = checklist ? rulesOf(checklist.items) : [];

  // No rules in force means there is nothing to review and nothing to compare.
  // Return early rather than bill a submission lookup for an empty section.
  if (rules.length === 0) {
    return { rules, acknowledgedAt: null, changedSinceInduction: false };
  }

  /*
   * The induction they actually sat, not merely their latest check-in.
   * `inductionReused` marks a check-in that rode on an earlier induction, and
   * counting one of those would date the acknowledgement to a day they were
   * never shown the rules.
   */
  const induction = await prisma.submission.findFirst({
    where: { workerId, jobSiteId: siteId, inductionReused: false },
    orderBy: { checkedInAt: 'desc' },
    select: { checkedInAt: true, checklistVersion: true },
  });
  if (!induction) {
    return { rules, acknowledgedAt: null, changedSinceInduction: false };
  }

  // The rules as they stood on the version this worker answered.
  const answered = await prisma.complianceChecklist.findUnique({
    where: { jobSiteId_version: { jobSiteId: siteId, version: induction.checklistVersion } },
    select: { items: { orderBy: { order: 'asc' }, select: { type: true, label: true, helpText: true } } },
  });

  return {
    rules,
    acknowledgedAt: induction.checkedInAt,
    // No stored version to compare against is an UNKNOWN, not a change.
    changedSinceInduction: answered
      ? siteRulesChanged(rulesOf(answered.items), rules)
      : false,
  };
}

/**
 * Does this site have induction rules to review?
 *
 * Read by the worker shell on every page, to decide whether Site information
 * stays reachable when a site has switched the SITE_INFORMATION panel off.
 * Rules an operative signed for are not hideable by panel config — the same
 * reasoning that keeps Attendance and Induction records always visible — but a
 * site with the panel off AND no rules is left exactly as it was, rather than
 * being given a nav item leading to an empty page.
 *
 * Two small indexed reads rather than loading the checklist: this runs on every
 * worker page, and it only ever needs to know whether the count is zero.
 */
export async function siteHasSiteRules(siteId: string): Promise<boolean> {
  const current = await prisma.complianceChecklist.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (!current) return false;
  const count = await prisma.checklistItem.count({
    where: { checklistId: current.id, type: ChecklistItemType.SITE_RULE },
  });
  return count > 0;
}
