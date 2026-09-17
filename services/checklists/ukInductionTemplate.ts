import { ChecklistItemType } from '@prisma/client';
import { UK_SITE_RULES_DEFAULT } from '@/services/checklists/ukSiteRulesLibrary';

/**
 * Standard UK construction site induction template.
 *
 * A sensible, HSE-aligned starting point for a site's compliance checklist:
 * site rules, RAMS, near-miss awareness, permit to work and
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
  /**
   * The standard site rules, shown to the operative underneath the
   * acknowledgement directly above and covered by it.
   *
   * Placed HERE, immediately after the statement that refers to them, rather than
   * appended at the end: order is what the induction reads by, and a rule set that
   * sits below the safe-working agreement is a rule set nobody connects to the
   * tick they have already made.
   *
   * `required: false` on every one, because a rule is never answered. Its row
   * exists to be displayed; the single acknowledgement above is the record. The
   * flag would only matter if a rule could gate a screen, and deliberately none
   * can - see SITE_RULE in the schema and buildInductionSteps.
   *
   * Only the DEFAULT tier is seeded - the universal rules. The optional templates
   * (smoking area, waste segregation, site traffic, phones, conduct) depend on how
   * a particular site is run, so a Site Manager ticks those on when they apply.
   *
   * A NEW site gets these. An existing site gets none until somebody opens its
   * Site rules section and saves, which is what keeps this shipping without
   * silently changing what a live induction says.
   */
  ...UK_SITE_RULES_DEFAULT.map((rule) => ({
    label: rule.label,
    helpText: rule.helpText,
    type: ChecklistItemType.SITE_RULE,
    required: false,
  })),
  {
    label:
      'I have read the Risk Assessments & Method Statements (RAMS) for my work.',
    helpText: 'Ask the site manager if you have not been issued the RAMS.',
    type: ChecklistItemType.ACKNOWLEDGEMENT,
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
  // SC-012: the CSCS card question has been removed — a worker's card details are
  // already captured and verified in their competency record (SC-001), and the
  // pre-induction landing surfaces the status. Asking again duplicated the data.
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
