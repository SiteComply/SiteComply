/**
 * SC-019 Phase 1 — the project setup wizard's step definitions.
 *
 * Client-safe (no Prisma/server imports) so the wizard UI, the completeness
 * indicator and the server-side save all work from ONE list. Adding a step means
 * editing this file and its save handler, nothing else.
 *
 * Two rules encoded here:
 *
 * 1. OWNERSHIP SPLIT (preserved from SC-008). A Director owns the project-level
 *    appointments — client, CDM duty holders, contract dates. A Site Manager owns
 *    the operational content they maintain day to day — welfare, rules, hazards,
 *    access. Making everything Director-only would take away capability SC-008
 *    deliberately gave site managers.
 *
 * 2. CONDITIONAL TRIGGERS are a small explicit set, NOT a rules engine. A step
 *    with `requiresFlag` is only asked when the named flag is on, so the wizard
 *    doesn't interrogate every site about temporary works it will never have.
 */

export type SetupOwner = 'DIRECTOR' | 'SITE_MANAGER';

/**
 * Flags gathered early that decide which later steps are relevant.
 *
 * ONLY cdmNotifiable REMAINS. The three site-condition flags - temporary works,
 * traffic management, high-risk activities - used to hide their own steps until
 * somebody had already typed into the textarea behind them, which meant the
 * question was never asked and a site with real temporary works read as complete
 * with no temporary-works scene in its induction. Those steps are now always
 * shown and ask outright; the ANSWER lives on SiteInformation.
 *
 * F10 is different and stays conditional: it is a legal notification that either
 * applies or does not, and the project step asks that question directly.
 */
export type SetupFlag = 'cdmNotifiable';

export interface SetupStep {
  key: string;
  title: string;
  /** One line explaining why the step exists. */
  description: string;
  owner: SetupOwner;
  /** Only asked when this flag is set — the explicit conditional set. */
  requiresFlag?: SetupFlag;
  /** Counts toward "ready to generate a Construction Phase Plan". */
  cppRequired: boolean;
  /**
   * Counts toward "ready to generate this site's induction video".
   *
   * ── WHY BOTH FLAGS AND NOT ONE ────────────────────────────────────────────
   *
   * The two documents need different things. A Construction Phase Plan needs the
   * CDM apparatus - duty holders, F10, appointment dates - which an induction
   * video never mentions. An induction video needs what an operative is shown and
   * must wear: the site rules they acknowledge, the PPE, control measures for every
   * hazard that applies. Neither list is a subset of the other, so a single
   * "required" flag would either hold up a video for an F10 reference or let a
   * plan pass with no PPE.
   *
   * Setup is complete when BOTH are satisfied. That is the point of the
   * restructure: finishing setup means you can generate either, immediately,
   * without discovering a gap on another screen.
   */
  videoRequired: boolean;
}

/**
 * The wizard, in order. The site itself is created from a short mandatory core
 * (name, job reference, address) BEFORE this wizard runs — see
 * SITE_CORE_FIELDS — so a Director can always create a site quickly and complete
 * the rest later. Save-and-resume depends on that.
 */
export const SETUP_STEPS: SetupStep[] = [
  {
    key: 'project',
    title: 'Project details',
    description: 'Scope of works, programme dates and CDM notifiable status.',
    owner: 'DIRECTOR',
    cppRequired: true,
    // The description and scope are what the induction's opening scenes say about
    // the work; without them an operative is told where they are and not what for.
    videoRequired: true,
  },
  {
    key: 'client',
    title: 'Client details',
    description: 'The commissioning client and their contact.',
    owner: 'DIRECTOR',
    cppRequired: true,
    videoRequired: false,
  },
  {
    key: 'duty-holders',
    title: 'CDM duty holders',
    description: 'Principal Designer and Principal Contractor, and when each was appointed.',
    owner: 'DIRECTOR',
    cppRequired: true,
    videoRequired: false,
  },
  {
    key: 'f10',
    title: 'F10 notification',
    description: 'The HSE reference for a notifiable project.',
    owner: 'DIRECTOR',
    requiresFlag: 'cdmNotifiable',
    cppRequired: true,
    videoRequired: false,
  },
  {
    key: 'people',
    title: 'Site personnel',
    description: 'Site managers, first aiders and fire marshals, with how to reach them.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    // A first aider here is one of the four things that BLOCK generation: an
    // operative must know who to find.
    videoRequired: true,
  },
  {
    key: 'emergency',
    title: 'Emergency arrangements',
    description:
      'What to do in an emergency, the fire assembly point, and how accidents and near misses are reported.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    // Two more of the four blockers: the procedures and the assembly point.
    videoRequired: true,
  },
  {
    key: 'welfare',
    title: 'Welfare and working hours',
    description: 'Facilities on site and the hours the site operates.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'rules',
    // This step edits the FREE-TEXT SiteInformation.siteRules field. Its old
    // description — "the rules every operative agrees to at induction" — named
    // the Site Rules Library instead, which is edited elsewhere and is what an
    // operative actually acknowledges. A manager following this wizard would
    // reasonably believe they had set the induction rules here. They had not.
    title: 'Additional site information',
    description:
      'Supplementary notes shown to operatives beneath the induction site rules.',
    owner: 'SITE_MANAGER',
    /*
     * NOT cppRequired ANY MORE, and that is a correction rather than a relaxation.
     * The plan's requirement was "at least one published site rule", which this
     * step cannot satisfy - it edits the supplementary free text. The requirement
     * moved with the rules themselves to the `induction` step, which IS required,
     * so the plan still needs a rule. A step with no requirements that claims to
     * gate a plan only inflates the figure.
     */
    cppRequired: false,
    /*
     * NOT videoRequired either, and worth being explicit: NOTHING in the induction
     * video reads this field. The rules an operative hears come from the Library,
     * which the `induction` step collects.
     */
    videoRequired: false,
  },
  {
    key: 'hazards',
    title: 'Hazards and existing risks',
    description:
      'Site-specific hazards and risks already present on the site or adjacent to it.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    /*
     * THE RISK REGISTER, moved into the journey.
     *
     * This is the step the whole restructure exists for. A hazard the register
     * marks as APPLYING with no control measures written is the one condition that
     * REFUSES to generate a video - and the register lived on a page with no link
     * to it from anywhere in the product. A manager could finish every other step
     * and still be unable to generate, with nothing telling them why or where to go.
     */
    key: 'risks',
    title: 'Significant risks and controls',
    description:
      'Which of the significant risks apply here, and how each one is controlled on this site.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'high-risk',
    title: 'High-risk activities',
    description: 'Whether this project involves high-risk activities, and how they are managed.',
    owner: 'SITE_MANAGER',
    // Always shown now, and it ASKS. See SetupFlag.
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'temporary-works',
    title: 'Temporary works',
    description: 'Whether this project has temporary works, and the arrangements for them.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'access',
    title: 'Access, egress and deliveries',
    description: 'How people and deliveries get on and off site.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'traffic',
    title: 'Traffic management',
    description:
      'Whether vehicles and pedestrians share routes here, and how they are kept apart.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'utilities',
    title: 'Utilities and isolation points',
    description: 'Live services, isolation points and who controls them.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'environment',
    title: 'Environmental controls',
    description: 'Noise, dust, spillage and waste arrangements for this site.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    /*
     * WHAT AN OPERATIVE IS TOLD AND MUST WEAR.
     *
     * Site rules and PPE are the two scenes an induction cannot sensibly omit, and
     * neither was collected here: the rules lived on another tab, and PPE was not
     * mentioned anywhere in setup at all. Both are versioned checklist items rather
     * than site fields, so this step HOSTS their existing editors rather than
     * building second ones - the same arrangement the permits step already uses.
     *
     * The induction notes join them because they are the same kind of thing - words
     * an operative is shown - and because they were previously reachable only from
     * a Director-only edit form that neither the wizard nor the Operative Experience
     * tab mentions.
     */
    key: 'induction',
    title: 'Site rules, PPE and induction notes',
    description:
      'The rules an operative acknowledges, the PPE this site requires, and any notes shown at induction.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
    videoRequired: true,
  },
  {
    key: 'drawings',
    title: 'Site map, drawings and RAMS',
    description:
      'The site layout map shown at induction, plus drawings and method statements filed as documents.',
    owner: 'SITE_MANAGER',
    cppRequired: false,
    // The map and the RAMS both produce scenes when present, and neither blocks
    // generation - a site legitimately may not have method statements yet. Asked
    // here so nobody has to find the upload on another tab.
    videoRequired: false,
  },
  {
    // SC-021. Appended rather than inserted so every existing step keeps its
    // position and no site's stored progress shifts meaning.
    //
    // owner SITE_MANAGER, which the wizard treats as "Director or Site Manager
    // may edit" (a DIRECTOR-owned step is the restricted one) — exactly the two
    // roles SC-021 names. NOT cppRequired: a Construction Phase Plan does not
    // depend on which optional modules a site uses, and marking it required
    // would make every existing site's CPP look incomplete overnight.
    key: 'services',
    title: 'Permits and inspections used',
    description:
      'Which permits, inspections and checks apply to this project. Everything is available until you turn it off.',
    owner: 'SITE_MANAGER',
    cppRequired: false,
    videoRequired: false,
  },
  {
    /*
     * THE WHOLE INDUCTION, IN ONE PLACE, LAST.
     *
     * Setup ends by showing what the finished video will contain: the company
     * modules and library footage every project carries, alongside what has just
     * been collected here. Nothing is edited that is not editable elsewhere - a
     * project may leave an optional piece of company content out, with a reason -
     * but the composition stops being something a manager discovers on a different
     * screen after generating.
     */
    key: 'company-content',
    title: 'Company induction content',
    description:
      'The company modules and videos this project will carry, alongside its own content.',
    owner: 'SITE_MANAGER',
    cppRequired: false,
    videoRequired: false,
  },
];


/** Fields that must exist before a site record is created at all. */
export const SITE_CORE_FIELDS = [
  'name',
  'jobReference',
  'addressLine1',
  'town',
  'postcode',
] as const;

export const SETUP_STEP_KEYS = SETUP_STEPS.map((s) => s.key);

export function isSetupStepKey(key: string): boolean {
  return SETUP_STEP_KEYS.includes(key);
}

/** The steps that actually apply to a site, given its conditional flags. */
export function applicableSteps(
  flags: Partial<Record<SetupFlag, boolean>>,
): SetupStep[] {
  return SETUP_STEPS.filter(
    (step) => !step.requiresFlag || flags[step.requiresFlag] === true,
  );
}

/** Steps a given role may edit — the ownership split, in one place. */
export function stepsForOwner(
  steps: SetupStep[],
  canEditProject: boolean,
): SetupStep[] {
  return canEditProject
    ? steps
    : steps.filter((s) => s.owner === 'SITE_MANAGER');
}

/*
 * SetupCompleteness and computeCompleteness(flags, completedSteps) were here.
 *
 * They decided completion from a list of step keys somebody had ticked, and
 * never looked at a single field value — so a site could be marked through with
 * every field blank and still report 100% and cppReady. Replaced by
 * siteSetupCompletion.computeDerivedCompleteness(), which reads the data.
 *
 * DELETED RATHER THAN DEPRECATED on purpose: a tick-based completeness function
 * left in this file is one import away from quietly coming back.
 */

