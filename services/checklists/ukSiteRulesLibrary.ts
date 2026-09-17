/**
 * Standard UK construction site rules.
 *
 * The rules a site typically posts at the gate: the everyday expectations an
 * operative is held to, rather than the statutory duties that sit behind them.
 * A starting point a site manager edits, not a compliance position — untick what
 * does not apply, add what is specific to the project.
 *
 * ── WHAT THESE ARE NOT ────────────────────────────────────────────────────
 *
 * Not legal advice, and not a substitute for the site's own rules. The wording
 * is deliberately plain and non-statutory: where a rule touches regulation the
 * site's own documents govern, and this list only tells an operative what is
 * expected of them on the ground.
 *
 * Kept as plain data, like UK_INDUCTION_TEMPLATE, so the seed, the API and the
 * editor all read one list and cannot drift apart.
 */

export interface SiteRuleTemplate {
  /** The rule as an operative reads it. Short, plain, actionable. */
  label: string;
  /** Optional detail shown beneath. Null where the rule speaks for itself. */
  helpText?: string;
}

/**
 * Selected by default on a NEW site. An existing site gains none of these until
 * someone opens its Site Rules section and saves.
 */
export const UK_SITE_RULES_LIBRARY: SiteRuleTemplate[] = [
  {
    label: 'Sign in on arrival and sign out when you leave.',
    helpText:
      'The register is how we know who is on site in an emergency.',
  },
  {
    label: 'Wear the PPE required for this site at all times in working areas.',
  },
  {
    label: 'Report all accidents, injuries and near misses straight away.',
    helpText: 'However minor, and even if nobody was hurt.',
  },
  {
    label: 'Do not start work without a valid permit where one is required.',
  },
  {
    label: 'Keep walkways, stairs and fire exits clear at all times.',
  },
  {
    label: 'Tidy your work area as you go and remove waste to the right skip.',
  },
  {
    label: 'Do not use plant or equipment you are not trained and authorised to use.',
  },
  {
    label: 'Check tools and equipment before use and report anything defective.',
  },
  {
    label: 'Do not remove or bypass guarding, barriers or safety devices.',
    helpText: 'If something must be moved to work safely, speak to the site manager first.',
  },
  {
    label: 'No alcohol or drugs on site. Do not work under the influence.',
    helpText:
      'Tell your supervisor if prescribed medication could affect your work.',
  },
  {
    label: 'Smoking and vaping only in the designated area.',
  },
  {
    label: 'Obey all site signage, speed limits and pedestrian routes.',
  },
  {
    label: 'On hearing the alarm, go to the assembly point and wait to be accounted for.',
  },
  {
    label: 'Mobile phones must not be used while operating plant or working at height.',
  },
  {
    label: 'Treat everyone on site with respect. Bullying and harassment are not tolerated.',
  },
];
