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
  {
    slug: 'COMPANY_INTRODUCTION',
    title: 'Company introduction',
    category: 'BEHAVIOUR',
    // First in the running order: it is the welcome.
    order: 5,
    // NOT mandatory and NOT included by default, because until somebody writes it
    // this module says nothing. Both become worth turning on once it is written.
    mandatory: true,
    defaultIncluded: true,
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
];

/**
 * AVAILABLE, BUT NOT PART OF THE STANDARD SET.
 *
 * ── WHY THIS TIER EXISTS ──────────────────────────────────────────────────
 *
 * Manual handling is TRAINING, not induction. An induction tells an operative about
 * the site they are standing on; manual-handling technique does not change with the
 * project and is not learned by watching a card. So it does not belong in the set
 * every company is prompted to create - but a company that wants it should not have
 * to do without, and a module can be created by NO OTHER ROUTE than seeding a
 * catalogue entry (there is no "new module" action).
 *
 * This is the same shape as the site rules library: `UK_SITE_RULES_DEFAULT` is
 * seeded into every site, while the optional templates are switched on by whoever
 * runs the site when they apply. Copied rather than invented, deliberately.
 *
 * Entries here are NEVER seeded automatically and NEVER counted as missing, so the
 * modules page cannot nag a company for declining one. `defaultIncluded: false`, so
 * even once created it reaches a project only when that project opts in.
 */
export const OPTIONAL_MODULE_CATALOGUE: CatalogueModule[] = [
  {
    slug: 'MANUAL_HANDLING',
    title: 'Manual handling',
    category: 'SAFETY',
    order: 50,
    mandatory: false,
    defaultIncluded: false,
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
];

/**
 * EVERY entry either tier can offer, for the one place that needs to resolve a slug
 * to its wording. Never use this for "what is missing" - that is the standard set
 * alone, or the prompt would ask for the optional ones too.
 */
export const ALL_CATALOGUE_MODULES: CatalogueModule[] = [
  ...MODULE_CATALOGUE,
  ...OPTIONAL_MODULE_CATALOGUE,
];

/**
 * SUBJECTS DELIBERATELY RETIRED FROM THE STANDARD SET (2026-09-30), and what covers
 * them instead. Recorded here so that re-adding one is a decision somebody argues
 * for, rather than a gap somebody "fixes".
 *
 *   PPE expectations        Site PPE GATES video generation
 *                           (siteSetupCompletion: "At least one PPE requirement",
 *                           gates: 'VIDEO'), so every video already carries a
 *                           required PPE scene built from that site's own list. A
 *                           company-wide PPE module could only ever duplicate a
 *                           scene guaranteed to be there - and PPE genuinely varies
 *                           by site, so the site's version is the better one.
 *   Housekeeping            Two DEFAULT site rules say it almost verbatim: "Keep
 *                           walkways, access routes and fire exits clear at all
 *                           times." and "Keep your work area clean and tidy as you
 *                           go." - and the operative acknowledges them.
 *   Environmental awareness The site's own ENVIRONMENTAL scene, plus the optional
 *                           waste-segregation rule. Environmental controls vary
 *                           enormously between sites (watercourses, dust, protected
 *                           species), so generic wording is the weaker answer.
 *
 * The rows themselves are RETIRED in the database, not deleted: a published
 * induction keeps the wording it was approved with, and the history stays readable.
 */
export const RETIRED_STANDARD_SLUGS = [
  'PPE_EXPECTATIONS',
  'HOUSEKEEPING',
  'ENVIRONMENTAL_AWARENESS',
] as const;


/** The seed set, keyed for lookups. */
export const CATALOGUE_BY_SLUG = new Map(
  MODULE_CATALOGUE.map((m) => [m.slug, m]),
);
