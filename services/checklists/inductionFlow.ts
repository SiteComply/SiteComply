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
