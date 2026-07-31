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

/** Flags gathered early that decide which later steps are relevant. */
export type SetupFlag =
  | 'hasTemporaryWorks'
  | 'hasTrafficManagement'
  | 'hasHighRiskActivities'
  | 'cdmNotifiable';

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
  },
  {
    key: 'client',
    title: 'Client details',
    description: 'The commissioning client and their contact.',
    owner: 'DIRECTOR',
    cppRequired: true,
  },
  {
    key: 'duty-holders',
    title: 'CDM duty holders',
    description:
      'Principal Designer and Principal Contractor appointments under CDM 2015.',
    owner: 'DIRECTOR',
    cppRequired: true,
  },
  {
    key: 'f10',
    title: 'F10 notification',
    description: 'Reference for the HSE notification on a notifiable project.',
    owner: 'DIRECTOR',
    requiresFlag: 'cdmNotifiable',
    cppRequired: true,
  },
  {
    key: 'people',
    title: 'Site personnel',
    description: 'Site managers, first aiders and fire marshals.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'emergency',
    title: 'Emergency arrangements',
    description:
      'Assembly points, fire arrangements, nearest hospital and procedures.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'welfare',
    title: 'Welfare and working hours',
    description: 'Facilities provided and the site’s working hours.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'rules',
    title: 'Site rules',
    description: 'The rules every worker agrees to at induction.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'hazards',
    title: 'Hazards and existing risks',
    description:
      'Site-specific hazards and risks already present on the site or adjacent to it.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'high-risk',
    title: 'High-risk activities',
    description: 'Activities needing specific control measures.',
    owner: 'SITE_MANAGER',
    requiresFlag: 'hasHighRiskActivities',
    cppRequired: true,
  },
  {
    key: 'temporary-works',
    title: 'Temporary works',
    description: 'Design, checks and sign-off for temporary works.',
    owner: 'SITE_MANAGER',
    requiresFlag: 'hasTemporaryWorks',
    cppRequired: false,
  },
  {
    key: 'access',
    title: 'Access, egress and deliveries',
    description: 'How people and deliveries get on and off site.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'traffic',
    title: 'Traffic management',
    description: 'Vehicle routes, segregation and banksman arrangements.',
    owner: 'SITE_MANAGER',
    requiresFlag: 'hasTrafficManagement',
    cppRequired: false,
  },
  {
    key: 'utilities',
    title: 'Utilities and isolation points',
    description: 'Services on site and where they are isolated.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'environment',
    title: 'Environmental controls',
    description: 'Dust, noise, spill and waste controls.',
    owner: 'SITE_MANAGER',
    cppRequired: true,
  },
  {
    key: 'drawings',
    title: 'Drawings and plans',
    description:
      'Site layout drawings and emergency plans, filed as site documents.',
    owner: 'SITE_MANAGER',
    cppRequired: false,
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

export interface SetupCompleteness {
  applicable: number;
  completed: number;
  percent: number;
  /** Steps still outstanding, in wizard order. */
  outstanding: SetupStep[];
  /** True when every CPP-required applicable step is done. */
  cppReady: boolean;
}

export function computeCompleteness(
  flags: Partial<Record<SetupFlag, boolean>>,
  completedSteps: string[],
): SetupCompleteness {
  const applicable = applicableSteps(flags);
  const done = new Set(completedSteps);
  const outstanding = applicable.filter((s) => !done.has(s.key));
  const completed = applicable.length - outstanding.length;
  return {
    applicable: applicable.length,
    completed,
    percent:
      applicable.length === 0
        ? 0
        : Math.round((completed / applicable.length) * 100),
    outstanding,
    cppReady: applicable
      .filter((s) => s.cppRequired)
      .every((s) => done.has(s.key)),
  };
}
