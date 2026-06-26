import { ChecklistItemType } from '@prisma/client';

/**
 * Standard UK construction site induction template.
 *
 * A sensible, HSE-aligned starting point for a site's compliance checklist:
 * site rules, RAMS, toolbox talk, near-miss awareness, permit to work, CSCS and
 * the core PPE items. Admins can add to, reorder or remove these per site in the
 * Stage 9 builder. Kept as plain data so it can be reused by both the seed and
 * the admin "start from template" action.
 *
 * The order field is assigned from array position when persisted.
 */
export interface ChecklistItemTemplate {
  label: string;
  helpText?: string;
  type: ChecklistItemType;
  required: boolean;
}

export const UK_INDUCTION_TEMPLATE: ChecklistItemTemplate[] = [
  {
    label: 'I have received and understood the site induction.',
    helpText:
      'Covers site layout, welfare facilities, working hours and emergency procedures.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
  {
    label: 'I have read and will follow the site rules and signage.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
  {
    label:
      'I have read the Risk Assessments & Method Statements (RAMS) for my work.',
    helpText: 'Ask the site manager if you have not been issued the RAMS.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
  {
    label: 'Have you attended the toolbox talk for today’s work?',
    type: ChecklistItemType.YES_NO,
    required: true,
  },
  {
    label:
      'I know how to report a near miss and where to find the first aider and welfare facilities.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
  {
    label:
      'I understand the permit to work system and will not start permit-controlled work without one.',
    helpText: 'Includes hot works, confined spaces and work at height permits.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
  {
    label: 'Do you hold a valid CSCS card for your trade?',
    helpText: 'You may be asked to show your card to the site manager.',
    type: ChecklistItemType.YES_NO,
    required: true,
  },
  // PPE confirmation items.
  {
    label: 'Hard hat',
    type: ChecklistItemType.PPE_CONFIRM,
    required: true,
  },
  {
    label: 'Hi-vis vest',
    type: ChecklistItemType.PPE_CONFIRM,
    required: true,
  },
  {
    label: 'Safety boots',
    type: ChecklistItemType.PPE_CONFIRM,
    required: true,
  },
  {
    label: 'Eye protection',
    type: ChecklistItemType.PPE_CONFIRM,
    required: true,
  },
  {
    label: 'Gloves',
    type: ChecklistItemType.PPE_CONFIRM,
    required: false,
  },
  {
    label: 'Ear defenders',
    type: ChecklistItemType.PPE_CONFIRM,
    required: false,
  },
  // Safe-working agreement — the final commitment before check-in.
  {
    label:
      'I agree to work safely, follow the CDM 2015 duties relevant to me, and stop work if conditions become unsafe.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
    required: true,
  },
];
