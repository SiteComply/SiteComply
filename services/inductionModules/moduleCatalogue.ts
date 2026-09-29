import type { InductionModuleCategory } from '@prisma/client';

/**
 * The starter set of company induction modules.
 *
 * ── WHAT THESE ARE ────────────────────────────────────────────────────────
 *
 * The topics every operative hears on every site, which do not change because
 * the project does. They are written once, issued by a Director, and inherited
 * by every induction — the counterpart to the site-specific scenes the rules
 * engine derives from a project's own records.
 *
 * ── THEY SHIP AS DRAFTS, NOT AS POLICY ────────────────────────────────────
 *
 * The narration below is a STARTING POINT written to be read aloud on a British
 * construction site, not company policy. Seeding it as issued would put words
 * into every operative's induction that no Director had read - which is exactly
 * the failure the whole versioned-module design exists to prevent. Each one is
 * created as draft revision 1 for a Director to read, edit and issue.
 *
 * ── WHY THE WORDING READS THE WAY IT DOES ─────────────────────────────────
 *
 * Spoken, not written: short sentences, second person, no sub-clauses, and no
 * instruction that depends on remembering an earlier one. An operative hears
 * this once, standing up, on a phone, before a shift.
 */

export interface CatalogueModule {
  slug: string;
  title: string;
  category: InductionModuleCategory;
  order: number;
  /** A site may NOT exclude a mandatory module. */
  mandatory: boolean;
  defaultIncluded: boolean;
  /**
   * When the project's own records cover the same ground, the SITE's text wins
   * and this module is left out — by the owner's decision, to avoid an
   * operative being told the same thing twice in one induction.
   */
  replacesSceneType?: string;
  heading: string;
  narration: string;
}

export const MODULE_CATALOGUE: CatalogueModule[] = [
  /*
   * ── THE ONE NOBODY ELSE CAN WRITE ─────────────────────────────────────
   *
   * Every other module in this list is a safety standard that reads much the same
   * on any British construction site, so a sensible draft can be offered and a
   * Director need only agree with it.
   *
   * A company introduction is not like that. It is the one piece of an induction
   * that is ABOUT THIS COMPANY - who we are, what we build, how we expect people to
   * be treated - and nobody outside it can write a word of that. It is here anyway,
   * and first, for three reasons:
   *
   *   it is the piece an operative meets before any other, so it should exist;
   *   its absence was actively confusing - a user could create a "Company
   *     Introduction" library video and find the only module to generate it from was
   *     PPE expectations, which would have produced a company introduction made of
   *     PPE content;
   *   a module that is present but unwritten asks a question, where a module that
   *     is missing entirely does not.
   *
   * So the narration below is deliberately NOT usable wording. It is a brief, in the
   * second person, telling whoever opens it what to write. It cannot be issued by
   * accident in the way generic-sounding filler could, because it plainly is not
   * about anybody's company.
   */
  {
    slug: 'COMPANY_INTRODUCTION',
    title: 'Company introduction',
    category: 'BEHAVIOUR',
    // First in the running order: it is the welcome.
    order: 5,
    // NOT mandatory and NOT included by default, because until somebody writes it
    // this module says nothing. Both become worth turning on once it is written.
    mandatory: false,
    defaultIncluded: false,
    heading: 'Welcome to the company',
    narration:
      'REPLACE THIS TEXT BEFORE ISSUING. This module is your company’s own ' +
      'introduction, and it is the first thing an operative hears. Say who the ' +
      'company is and what it builds. Say how long it has been doing it, if that ' +
      'matters to you. Say what you expect of people on your sites and what they can ' +
      'expect of you in return — how someone raises a concern, and what happens when ' +
      'they do. Keep it to about forty seconds spoken: short sentences, second ' +
      'person, no sub-clauses. Somebody hears this once, standing up, on a phone, ' +
      'before a shift.',
  },
  {
    slug: 'PPE_EXPECTATIONS',
    title: 'PPE expectations',
    category: 'SAFETY',
    order: 10,
    mandatory: true,
    defaultIncluded: true,
    heading: 'What we expect of your PPE',
    narration:
      'Your personal protective equipment is the last thing between you and an ' +
      'injury, so we expect it to be worn properly and kept in good condition. ' +
      'Wear it from the moment you enter the working area, not from the moment ' +
      'somebody asks. If any of it is damaged, worn out or does not fit, stop ' +
      'and speak to your supervisor, and we will replace it. Do not borrow ' +
      'somebody else’s and do not make do. The specific items this site requires ' +
      'are covered separately in your induction.',
  },
  {
    slug: 'BEHAVIOURAL_STANDARDS',
    title: 'Behavioural standards',
    category: 'BEHAVIOUR',
    order: 20,
    mandatory: true,
    defaultIncluded: true,
    heading: 'How we expect people to behave',
    narration:
      'Everybody on this site goes home in the condition they arrived in, and ' +
      'that depends on how people behave as much as on any procedure. Treat ' +
      'everyone on site with respect, whoever they work for. Do not take ' +
      'shortcuts, and do not let anybody pressure you into one. Nobody may work ' +
      'under the influence of alcohol or drugs, and that includes prescription ' +
      'medicines that affect what you are doing — tell your supervisor if you ' +
      'are taking any. Mobile phones are not to be used while you are walking ' +
      'through the works or operating anything. If you see something unsafe, you ' +
      'are expected to stop it, and you will be supported for doing so.',
  },
  {
    slug: 'ACCIDENT_REPORTING',
    title: 'Accident and near-miss reporting',
    category: 'REPORTING',
    order: 30,
    mandatory: true,
    defaultIncluded: true,
    /*
     * A project that records its own incident-reporting arrangement says
     * something more specific than this - a named person, a particular process -
     * so the site's own words win and this module is left out of that induction.
     */
    replacesSceneType: 'INCIDENT_REPORTING',
    heading: 'Reporting accidents and near misses',
    narration:
      'Report every accident, however minor, on the day it happens. Report near ' +
      'misses as well — the times when nothing was damaged and nobody was hurt, ' +
      'but easily could have been. A near miss reported today is the accident ' +
      'that does not happen next week, and nobody is ever in trouble for ' +
      'reporting one. Tell your supervisor or the site manager straight away, ' +
      'and make sure it is written down before you leave site.',
  },
  {
    slug: 'HOUSEKEEPING',
    title: 'Housekeeping',
    category: 'SAFETY',
    order: 40,
    mandatory: false,
    defaultIncluded: true,
    heading: 'Keeping the site tidy',
    narration:
      'Most slips, trips and falls on a construction site come down to ' +
      'housekeeping. Clear up as you go rather than leaving it to the end of the ' +
      'shift. Keep walkways, stairs and escape routes clear at all times, ' +
      'including of trailing leads. Put waste in the right skip, and keep ' +
      'materials stacked so they cannot topple. If you find a mess that is not ' +
      'yours and it is unsafe, deal with it or report it — do not walk past it.',
  },
  {
    slug: 'MANUAL_HANDLING',
    title: 'Manual handling',
    category: 'SAFETY',
    order: 50,
    mandatory: false,
    defaultIncluded: true,
    heading: 'Lifting and carrying',
    narration:
      'Before you lift anything, ask whether it needs to be lifted by hand at ' +
      'all — use a trolley, a hoist or a telehandler where one is available. If ' +
      'you do lift, think about the route first, keep the load close to your ' +
      'body, bend your knees rather than your back, and do not twist as you ' +
      'lift. If a load is too heavy or an awkward shape, get help; there is no ' +
      'prize for managing on your own. Back injuries are the most common reason ' +
      'people leave this industry early.',
  },
  {
    slug: 'ENVIRONMENTAL_AWARENESS',
    title: 'Environmental awareness',
    category: 'ENVIRONMENT',
    order: 60,
    mandatory: false,
    defaultIncluded: true,
    heading: 'Looking after the environment',
    narration:
      'What we do on site affects the people around it and the ground underneath ' +
      'it. Keep fuels, oils and chemicals in their bunds or spill trays, and ' +
      'never pour anything down a drain. If you spill something, contain it and ' +
      'report it immediately — a small spill dealt with straight away is not an ' +
      'incident. Segregate waste into the right skips. Keep noise and dust down ' +
      'where you can, especially near occupied buildings, and switch plant off ' +
      'rather than leaving it running.',
  },
];

/** The seed set, keyed for lookups. */
export const CATALOGUE_BY_SLUG = new Map(
  MODULE_CATALOGUE.map((m) => [m.slug, m]),
);
