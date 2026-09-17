/**
 * Standard UK construction site rules.
 *
 * Two tiers, and the difference matters:
 *
 *   DEFAULT (`defaultSelected: true`) — rules that hold on essentially every UK
 *   construction site, whatever its size, trade or client. These are seeded onto
 *   a new site already selected.
 *
 *   OPTIONAL (`defaultSelected: false`) — rules that are real and common but
 *   depend on how a particular site is run: a designated smoking area, a waste
 *   segregation scheme, vehicle movements, a phone policy, a conduct policy. A
 *   Site Manager ticks these on when they apply. They are NOT seeded.
 *
 * The split exists because a default that does not apply is worse than no
 * default: it teaches operatives that the rule list is boilerplate to scroll
 * past, which is exactly what the single acknowledgement depends on them not
 * doing. A rule presupposing a designated smoking area, on a site that has
 * banned smoking outright, is not a stricter rule — it is a wrong one.
 *
 * ── WHAT THESE ARE NOT ────────────────────────────────────────────────────
 *
 * Not legal advice, and not a substitute for the site's own rules. The wording
 * is deliberately plain and non-statutory: where a rule touches regulation the
 * site's own documents govern, and this list only tells an operative what is
 * expected of them on the ground.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 *
 * Anything the operative already acknowledges by ticking a box on the same
 * induction. Two rules were removed for this reason and must not come back:
 *
 *   - permit to work. Covered verbatim by "I understand the permit to work
 *     system and will not start permit-controlled work without one."
 *   - site signage. Covered by the acknowledgement the rules are displayed
 *     directly beneath: "I have read and will follow the site rules AND
 *     SIGNAGE."
 *
 * Restating a tick the operative makes inches away does not reinforce it; it
 * pads the list and costs the rules that do carry new information their
 * attention. See UK_INDUCTION_TEMPLATE for what is already acknowledged.
 *
 * Kept as plain data, like UK_INDUCTION_TEMPLATE, so the seed, the API and the
 * editor all read one list and cannot drift apart.
 */

export interface SiteRuleTemplate {
  /** The rule as an operative reads it. Short, plain, actionable. */
  label: string;
  /** Optional detail shown beneath. Omitted where the rule speaks for itself. */
  helpText?: string;
  /**
   * Seeded onto a NEW site, already selected.
   *
   * Required rather than optional, deliberately: every entry has to state which
   * tier it is in. A missing flag defaulting to false would quietly drop a rule
   * off every new site, and defaulting to true would quietly put a site-specific
   * rule on one.
   */
  defaultSelected: boolean;
}

export const UK_SITE_RULES_LIBRARY: SiteRuleTemplate[] = [
  // ── Default: universal ────────────────────────────────────────────────────
  {
    label: 'Sign in on arrival and sign out when you leave.',
    helpText: 'The register is how we know who is on site in an emergency.',
    defaultSelected: true,
  },
  {
    label: 'Wear the PPE required for this site at all times in working areas.',
    defaultSelected: true,
  },
  {
    // Kept despite overlapping "I know how to report a near miss...". That
    // acknowledgement is about KNOWING HOW; this is about doing it, and covers
    // accidents and injuries, which the acknowledgement does not mention.
    label: 'Report all accidents, injuries and near misses straight away.',
    helpText: 'However minor, and even if nobody was hurt.',
    defaultSelected: true,
  },
  {
    // "access routes", not "stairs" - a groundworks or highways site has none.
    label: 'Keep walkways, access routes and fire exits clear at all times.',
    defaultSelected: true,
  },
  {
    // The skip is gone: waste segregation is a site arrangement, and lives in
    // the optional tier below. Tidying as you go is universal.
    label: 'Keep your work area clean and tidy as you go.',
    defaultSelected: true,
  },
  {
    label: 'Do not use plant or equipment you are not trained and authorised to use.',
    defaultSelected: true,
  },
  {
    label: 'Check tools and equipment before use and report anything defective.',
    defaultSelected: true,
  },
  {
    label: 'Do not remove or bypass guarding, barriers or safety devices.',
    helpText:
      'If something must be moved to work safely, speak to the site manager first.',
    defaultSelected: true,
  },
  {
    // "stop work" is the part people forget under an alarm.
    label:
      'On hearing the alarm, stop work, go to the assembly point and wait to be accounted for.',
    defaultSelected: true,
  },
  {
    // A DIRECT SAFETY REQUIREMENT, kept as a default by owner decision: working
    // impaired is a hazard on every site, not a matter of conduct.
    //
    // Phrased as impairment rather than possession. "No alcohol or drugs on
    // site" is a possession rule, which is company policy and genuinely varies -
    // sealed containers left in a vehicle, prescription medication. Working
    // under the influence does not vary anywhere.
    label: 'Do not work under the influence of alcohol or drugs.',
    helpText:
      'Tell your supervisor if prescribed medication could affect your work.',
    defaultSelected: true,
  },

  // ── Optional: real and common, but depends how the site is run ────────────
  {
    // Presupposes a designated area exists. Some sites ban smoking outright.
    label: 'Smoking and vaping only in the designated area.',
    defaultSelected: false,
  },
  {
    // A site waste arrangement, not a rule of construction.
    label: 'Segregate waste and use the correct skip for each material.',
    defaultSelected: false,
  },
  {
    // Presupposes vehicle movements and pedestrian segregation.
    label: 'Observe the site speed limit and keep to marked pedestrian routes.',
    defaultSelected: false,
  },
  {
    // Narrow in scope, and phone policies vary widely by principal contractor.
    label: 'Mobile phones must not be used while operating plant or working at height.',
    defaultSelected: false,
  },
  {
    // A company code of conduct, normally enforced through HR rather than the
    // induction. Offered here for sites that want it stated at the gate.
    label: 'Treat everyone on site with respect. Bullying and harassment are not tolerated.',
    defaultSelected: false,
  },
];

/** The subset seeded onto a NEW site, already selected. */
export const UK_SITE_RULES_DEFAULT: SiteRuleTemplate[] =
  UK_SITE_RULES_LIBRARY.filter((r) => r.defaultSelected);
