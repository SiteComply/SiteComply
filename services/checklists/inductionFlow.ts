/**
 * Pure induction-flow logic, shared by the server page and the client wizard.
 *
 * Turns a site's ordered checklist items into a sequence of one-question-per-
 * screen steps: acknowledgements and yes/no questions get their own screen,
 * consecutive PPE-confirm items collapse into a single "confirm your PPE" group,
 * and a UK GDPR consent screen is always appended last.
 *
 * Kept free of Prisma/React imports so it can run anywhere and the worker flow
 * only ever receives plain, serialisable data.
 */

import type { BriefingScreen } from '@/services/induction/inductionBriefing';

export type InductionItemType =
  | 'ACKNOWLEDGEMENT'
  | 'YES_NO'
  | 'PPE_CONFIRM'
  | 'SITE_RULE';

/**
 * SC-012: the seeded duplicate CSCS induction question. Its details are already
 * captured and verified in the worker's competency record (SC-001), so it is
 * filtered out of the live induction rather than asked again. Matched by the
 * seeded label + YES_NO type so existing site checklists are handled without a
 * data migration; the pre-induction landing surfaces the competency status
 * instead.
 */
export const CSCS_INDUCTION_LABEL =
  'Do you hold a valid CSCS card for your trade?';

export function isCscsCompetencyItem(item: {
  label: string;
  type: string;
}): boolean {
  return (
    item.type === 'YES_NO' &&
    item.label.trim().toLowerCase() === CSCS_INDUCTION_LABEL.toLowerCase()
  );
}

/**
 * SC-018: the seeded toolbox-talk induction question. Toolbox talks are delivered
 * separately by supervisors in daily briefings, so requiring every worker to
 * answer this at check-in added a step without adding assurance. It is filtered
 * out of the live induction rather than deleted, for the same reasons as the CSCS
 * question above: checklist items are VERSIONED and historic submissions record
 * the version they answered, so removing rows would corrupt past records.
 *
 * Matched on the exact seeded label + YES_NO type. Deliberately NOT a fuzzy
 * "contains toolbox" match — a site that has deliberately added its own
 * toolbox-talk question must keep it.
 *
 * Where a toolbox talk genuinely needs recording, the existing Daily Bulletin
 * (SC-002) issues and records an acknowledged briefing, and Documents has a
 * GENERAL category for the paperwork.
 */
export const TOOLBOX_TALK_INDUCTION_LABEL =
  'Have you attended the toolbox talk for today’s work?';

export function isToolboxTalkItem(item: {
  label: string;
  type: string;
}): boolean {
  return (
    item.type === 'YES_NO' &&
    normaliseLabel(item.label) === normaliseLabel(TOOLBOX_TALK_INDUCTION_LABEL)
  );
}

/**
 * Normalise a label for comparison. The seeded label contains a TYPOGRAPHIC
 * apostrophe (’); a site checklist edited by hand may carry a straight one ('),
 * and the two must be treated as the same question.
 */
function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[’‘']/g, "'");
}

/**
 * Items removed from the live induction by a REV-1 decision but left in stored
 * checklists so historic submissions stay intact. One predicate so every caller
 * (wizard render and server-side validation) filters identically.
 */
export function isRetiredInductionItem(item: {
  label: string;
  type: string;
}): boolean {
  return isCscsCompetencyItem(item) || isToolboxTalkItem(item);
}

/**
 * Owner Review Item 14 — grouping related acknowledgements onto one screen.
 *
 * The induction ran to EIGHT screens, six of which held a single tick on an
 * otherwise empty phone viewport. Nothing is removed here: every acknowledgement
 * is still made individually, still stored under its own checklist item id in
 * `Submission.answers`, and still validated individually. What changes is how
 * many times somebody presses Continue.
 *
 * Sections are matched on the SEEDED LABEL, the same mechanism SC-012 and SC-018
 * already use for the retired questions above. That means:
 *   - no schema change and no migration, so this ships to existing sites at once;
 *   - a site that has edited a label, or added its own item, is untouched — the
 *     item simply keeps its own screen, exactly as today. Grouping is opt-out by
 *     construction rather than something that can surprise a customised site.
 *
 * Deliberately NOT adjacency-based, unlike the PPE run. In the seeded template
 * the two themes interleave (briefing, briefing, work, briefing, work, …, work),
 * so adjacency could not produce coherent sections. A section therefore collects
 * its members wherever they appear, and the screen takes the position of the
 * FIRST one, which keeps any custom items a site has added in sensible places
 * around it.
 *
 * GDPR consent is deliberately absent from this list. It stays on its own screen:
 * UK GDPR requires consent to be specific and unbundled, and putting it behind
 * the same button as a safety declaration would weaken the basis for holding the
 * data to save one tap.
 */
export interface InductionSection {
  key: string;
  heading: string;
  intro: string;
  /** Seeded labels belonging to this section, matched via normaliseLabel. */
  labels: string[];
}

export const INDUCTION_SECTIONS: InductionSection[] = [
  {
    key: 'site-briefing',
    heading: 'Your site briefing',
    intro: 'Confirm what you have been told about this site.',
    labels: [
      'I have received and understood the site induction.',
      'I have read and will follow the site rules and signage.',
      'I know how to report a near miss and where to find the first aider and welfare facilities.',
    ],
  },
  {
    key: 'work-and-permits',
    heading: 'Your work and permits',
    intro: 'Confirm you understand the work you are about to do, and how to do it safely.',
    labels: [
      'I have read the Risk Assessments & Method Statements (RAMS) for my work.',
      'I understand the permit to work system and will not start permit-controlled work without one.',
      'I agree to work safely, follow the CDM 2015 duties relevant to me, and stop work if conditions become unsafe.',
    ],
  },
];

const SECTION_BY_LABEL = new Map<string, InductionSection>(
  INDUCTION_SECTIONS.flatMap((section) =>
    section.labels.map((label) => [normaliseLabel(label), section] as const),
  ),
);

/** The section an item belongs to, or null if it keeps its own screen. */
export function sectionFor(item: {
  label: string;
  type: string;
}): InductionSection | null {
  if (item.type !== 'ACKNOWLEDGEMENT') return null;
  return SECTION_BY_LABEL.get(normaliseLabel(item.label)) ?? null;
}

/**
 * SITE RULES LIBRARY - the acknowledgement that covers the site's rule set.
 *
 * One acknowledgement for the whole set, not one per rule. That is a deliberate
 * product decision and also the honest one: a person who is made to tick fifteen
 * boxes in a row stops reading at about the third, and fifteen ticks are not
 * fifteen times the assurance of one. The statement below is what the operative
 * agrees to; the rules are what it refers to, displayed with it so "the site
 * rules" names something they can actually see.
 *
 * This is the SEEDED label, matched the same way INDUCTION_SECTIONS matches
 * (normalised, so a straight apostrophe or stray case still hits). A site that
 * has reworded it keeps its own wording and simply hosts the rules on whichever
 * screen that item lands on - see buildInductionSteps' fallback.
 */
export const SITE_RULES_ACK_LABEL =
  'I have read and will follow the site rules and signage.';

export function isSiteRulesAck(item: { label: string; type: string }): boolean {
  return (
    item.type === 'ACKNOWLEDGEMENT' &&
    normaliseLabel(item.label) === normaliseLabel(SITE_RULES_ACK_LABEL)
  );
}

export interface FlowItem {
  id: string;
  label: string;
  helpText?: string | null;
  type: InductionItemType;
  required: boolean;
}

/**
 * `rules` is DISPLAY ONLY, on whichever screen carries the site-rules
 * acknowledgement. It never adds anything to answer: isStepComplete ignores it,
 * and the rules carry no entry in the answers map at all. The one acknowledgement
 * on the same screen is the whole record.
 */
export type InductionStep =
  | { kind: 'acknowledgement'; item: FlowItem; rules?: FlowItem[] }
  | {
      kind: 'section';
      section: InductionSection;
      items: FlowItem[];
      rules?: FlowItem[];
    }
  | { kind: 'yesno'; item: FlowItem }
  | { kind: 'ppe'; items: FlowItem[] }
  /**
   * The fallback: rules exist but nothing on the checklist acknowledges them,
   * because the site deleted or reworded the acknowledgement past recognition.
   * Shown on their own rather than dropped - rules a manager has published must
   * reach the operative either way - but with nothing to tick, since there is no
   * statement left to agree to.
   */
  | { kind: 'rules'; items: FlowItem[] }
  /**
   * A site briefing screen: information to READ, before anything is confirmed.
   * Nothing to tick - the acknowledgements that follow are what the operative
   * agrees to, and they now come after what they refer to.
   */
  | { kind: 'briefing'; screen: BriefingScreen }
  | { kind: 'gdpr' };

/** A single answer value, keyed in the answers map by checklist item id. */
export type AnswerValue = boolean | 'yes' | 'no';
export type InductionAnswers = Record<string, AnswerValue>;

/** Build the ordered list of induction steps for a checklist. */
export function buildInductionSteps(
  items: FlowItem[],
  /**
   * The site briefing, read first. Every screen comes BEFORE the first
   * acknowledgement: "I have received and understood the site induction" is
   * only a fair thing to ask once the induction has been shown. Empty for a
   * site with nothing to brief, which leaves the flow exactly as it was.
   */
  briefing: BriefingScreen[] = [],
): InductionStep[] {
  const steps: InductionStep[] = briefing.map((screen) => ({
    kind: 'briefing' as const,
    screen,
  }));
  let ppeRun: FlowItem[] = [];

  // SITE RULES LIBRARY. Gathered up front and never given a screen of their own:
  // they ride on whichever step carries the site-rules acknowledgement. Collected
  // wherever they appear in the checklist, like a section's members, so a rule a
  // manager dragged elsewhere still reaches the right screen.
  const rules = items.filter((i) => i.type === 'SITE_RULE');
  let rulesPlaced = false;
  let rulesAnchorSet = false;
  // Where a standalone rules screen would go if nothing claims them: the position
  // the first rule occupies in the reading order.
  let rulesAnchor = 0;

  const flushPpe = () => {
    if (ppeRun.length > 0) {
      steps.push({ kind: 'ppe', items: ppeRun });
      ppeRun = [];
    }
  };

  // Collect each section's members first. A section is NOT adjacency-based (see
  // INDUCTION_SECTIONS), so its members have to be known before the first one is
  // reached — that is where its single screen goes.
  const members = new Map<string, FlowItem[]>();
  for (const item of items) {
    const section = sectionFor(item);
    if (!section) continue;
    const list = members.get(section.key);
    if (list) list.push(item);
    else members.set(section.key, [item]);
  }
  const placed = new Set<string>();

  for (const item of items) {
    if (item.type === 'SITE_RULE') {
      // Remember where the rules sat, then let the rest of the loop ignore them.
      if (!rulesAnchorSet) {
        rulesAnchor = steps.length + (ppeRun.length > 0 ? 1 : 0);
        rulesAnchorSet = true;
      }
      continue;
    }
    if (item.type === 'PPE_CONFIRM') {
      ppeRun.push(item);
      continue;
    }
    flushPpe();

    const section = sectionFor(item);
    if (section) {
      if (placed.has(section.key)) continue; // already on its own screen
      placed.add(section.key);
      const group = members.get(section.key) ?? [item];
      // Does this section carry the site-rules acknowledgement? If so the rules
      // are shown on it, beneath the statement that covers them.
      const sectionRules =
        rules.length > 0 && group.some(isSiteRulesAck) ? rules : undefined;
      if (sectionRules) rulesPlaced = true;
      // A section left with one member — because a site deleted the others —
      // would render a section heading above a single tick. Fall back to the
      // ordinary acknowledgement screen, which is what it now is.
      if (group.length === 1) {
        steps.push({
          kind: 'acknowledgement',
          item: group[0]!,
          ...(sectionRules ? { rules: sectionRules } : {}),
        });
      } else {
        steps.push({
          kind: 'section',
          section,
          items: group,
          ...(sectionRules ? { rules: sectionRules } : {}),
        });
      }
      continue;
    }

    if (item.type === 'YES_NO') steps.push({ kind: 'yesno', item });
    else {
      // An ungrouped acknowledgement - a site that reworded or moved the seeded
      // one out of its section still hosts the rules if the wording matches.
      const own = rules.length > 0 && isSiteRulesAck(item) ? rules : undefined;
      if (own) rulesPlaced = true;
      steps.push({
        kind: 'acknowledgement',
        item,
        ...(own ? { rules: own } : {}),
      });
    }
  }
  flushPpe();

  // Nothing claimed them. Show them anyway, where they were.
  if (rules.length > 0 && !rulesPlaced) {
    steps.splice(Math.min(rulesAnchor, steps.length), 0, {
      kind: 'rules',
      items: rules,
    });
  }

  // UK GDPR consent is always the final step before check-in.
  steps.push({ kind: 'gdpr' });
  return steps;
}

/** Whether the answers satisfy a step's required items (i.e. can advance). */
export function isStepComplete(
  step: InductionStep,
  answers: InductionAnswers,
  gdprConsent: boolean,
): boolean {
  switch (step.kind) {
    case 'acknowledgement':
      return !step.item.required || answers[step.item.id] === true;
    case 'section':
      // Every required member, individually — the same rule the PPE screen uses.
      // Grouping changes the number of screens, never what has to be answered.
      return step.items
        .filter((i) => i.required)
        .every((i) => answers[i.id] === true);
    case 'yesno': {
      const v = answers[step.item.id];
      return !step.item.required || v === 'yes' || v === 'no';
    }
    case 'ppe':
      return step.items
        .filter((i) => i.required)
        .every((i) => answers[i.id] === true);
    case 'briefing':
      // Read, not answered.
      return true;
    case 'rules':
      // Nothing to answer. A rule is read, not ticked - the acknowledgement that
      // covers the set is a separate item on a separate screen, and this step only
      // exists when that item is gone.
      return true;
    case 'gdpr':
      return gdprConsent === true;
  }
}
