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

export type InductionItemType = 'ACKNOWLEDGEMENT' | 'YES_NO' | 'PPE_CONFIRM';

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

export interface FlowItem {
  id: string;
  label: string;
  helpText?: string | null;
  type: InductionItemType;
  required: boolean;
}

export type InductionStep =
  | { kind: 'acknowledgement'; item: FlowItem }
  | { kind: 'yesno'; item: FlowItem }
  | { kind: 'ppe'; items: FlowItem[] }
  | { kind: 'gdpr' };

/** A single answer value, keyed in the answers map by checklist item id. */
export type AnswerValue = boolean | 'yes' | 'no';
export type InductionAnswers = Record<string, AnswerValue>;

/** Build the ordered list of induction steps for a checklist. */
export function buildInductionSteps(items: FlowItem[]): InductionStep[] {
  const steps: InductionStep[] = [];
  let ppeRun: FlowItem[] = [];

  const flushPpe = () => {
    if (ppeRun.length > 0) {
      steps.push({ kind: 'ppe', items: ppeRun });
      ppeRun = [];
    }
  };

  for (const item of items) {
    if (item.type === 'PPE_CONFIRM') {
      ppeRun.push(item);
      continue;
    }
    flushPpe();
    if (item.type === 'YES_NO') steps.push({ kind: 'yesno', item });
    else steps.push({ kind: 'acknowledgement', item });
  }
  flushPpe();

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
    case 'yesno': {
      const v = answers[step.item.id];
      return !step.item.required || v === 'yes' || v === 'no';
    }
    case 'ppe':
      return step.items
        .filter((i) => i.required)
        .every((i) => answers[i.id] === true);
    case 'gdpr':
      return gdprConsent === true;
  }
}
