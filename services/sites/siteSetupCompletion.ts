/**
 * CPP completion — derived from CONTENT, never from a tick.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Completion used to be `completedSteps.includes(key)`: a string appended when
 * somebody pressed "Save and mark complete". The old computeCompleteness never
 * saw a single field value, and the API accepted `markComplete` without looking
 * at the data, so a site could be ticked through with every field blank and the
 * Construction Phase Plan would print "Status: All required sections recorded"
 * directly above a screen-only list of the sections that were missing. Two
 * definitions of the same word, on the same page, and the false one was the one
 * that printed.
 *
 * Completion is now computed from the data and cannot be asserted. A user can
 * still record that they have REVIEWED a section — that is a personal tracking
 * flag and deliberately carries no compliance claim.
 *
 * ── CLIENT-SAFE, AND THAT IS LOAD-BEARING ─────────────────────────────────
 *
 * No Prisma, no server imports. The wizard must reach the same verdict as the
 * server from the values in the form, or the badge under the user's cursor and
 * the status on the printed plan disagree — which is the exact bug being fixed.
 * Both sides build a `SetupSnapshot` and call in here; see buildSetupSnapshot
 * in siteSetupService for the server's mapping.
 *
 * ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────
 *
 * It checks that required information is PRESENT and well-formed. It does not
 * and cannot judge whether a plan is adequate or sufficient — that remains the
 * Principal Contractor's duty under CDM 2015, and the draft banner still says
 * so. "Complete" here means "nothing required is missing", never "approved".
 */

import { SETUP_STEPS, applicableSteps, type SetupFlag } from '@/services/sites/siteSetupConstants';

export type SectionStatus = 'EMPTY' | 'PARTIAL' | 'COMPLETE';

/**
 * The values a step's fields hold, keyed exactly as the wizard keys them
 * (`values[stepKey][fieldName]`), plus the counts that live in their own tables.
 */
export interface SetupSnapshot {
  values: Record<string, Record<string, unknown> | undefined>;
  counts: {
    siteManagers: number;
    firstAiders: number;
    /** Published SITE_RULE items — the Site Rules Library, not free text. */
    siteRules: number;
  };
}

/** One thing a section needs before it can be called complete. */
type Requirement =
  | { kind: 'text'; field: string; label: string; min?: number }
  | { kind: 'date'; field: string; label: string }
  | { kind: 'answered'; field: string; label: string }
  | { kind: 'either'; fields: string[]; label: string }
  | { kind: 'count'; of: keyof SetupSnapshot['counts']; label: string };

/**
 * MINIMUM SUBSTANCE for a narrative field.
 *
 * Presence alone is gameable: a single character would pass, and "tbc" is how a
 * plan quietly acquires a hole. Fifteen characters is deliberately low — it
 * rejects a placeholder without pretending to assess quality, which software
 * cannot do. Raising it would start failing legitimately terse answers like
 * "Mon-Fri 07:30-17:00".
 */
const MIN_NARRATIVE = 15;

/**
 * Placeholders that mean "not answered" while looking answered. Matched on the
 * WHOLE trimmed value, never as a substring: "TBC" is a hole, but "Access via
 * Gate 2; crane position TBC" is a real answer that happens to contain it.
 */
const PLACEHOLDERS = new Set([
  'n/a', 'na', 'n.a.', 'none', 'nil', 'tbc', 't.b.c.', 'tba', 'todo', 'to do',
  'to follow', 'unknown', 'x', '-', '--', '.', '?', 'pending', 'see above',
]);

const squash = (v: unknown): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';

/** A narrative answer that is actually an answer. */
export function hasSubstance(value: unknown, min = MIN_NARRATIVE): boolean {
  const t = squash(value);
  if (t === '') return false;
  if (PLACEHOLDERS.has(t.toLowerCase())) return false;
  return t.length >= min;
}

/** A short structured value — a name, a reference. Substance rules still apply,
 *  but the length floor does not: "Acme Ltd" is a complete answer. */
function hasShortValue(value: unknown): boolean {
  return hasSubstance(value, 2);
}

function hasDate(value: unknown): boolean {
  const t = squash(value);
  if (t === '') return false;
  // The wizard holds dates as YYYY-MM-DD strings; the server maps Dates to the
  // same form, so one check covers both.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return !Number.isNaN(new Date(`${t}T00:00:00.000Z`).getTime());
}

/** A yes/no that has actually been answered. `false` is an answer. */
function isAnswered(value: unknown): boolean {
  return value === true || value === false;
}

/**
 * WHAT EACH SECTION NEEDS.
 *
 * Mandatory means: a UK Principal Contractor would consider the plan deficient
 * without it. Everything else on the form stays optional and still appears in
 * the plan when filled — this decides completion, not what is collected.
 */
const REQUIREMENTS: Record<string, Requirement[]> = {
  project: [
    { kind: 'text', field: 'description', label: 'Project description' },
    { kind: 'text', field: 'scopeOfWorks', label: 'Scope of works' },
    { kind: 'date', field: 'startDate', label: 'Start date' },
    { kind: 'date', field: 'plannedEndDate', label: 'Planned completion' },
    { kind: 'answered', field: 'cdmNotifiable', label: 'CDM notifiable answered' },
  ],
  client: [
    { kind: 'text', field: 'clientName', label: 'Client organisation', min: 2 },
    { kind: 'text', field: 'clientContactName', label: 'Contact name', min: 2 },
    // One route to the client is required; which one is theirs to choose.
    { kind: 'either', fields: ['clientContactEmail', 'clientContactPhone'], label: 'Contact email or phone' },
  ],
  'duty-holders': [
    { kind: 'text', field: 'principalDesigner', label: 'Principal Designer', min: 2 },
    { kind: 'text', field: 'principalContractor', label: 'Principal Contractor', min: 2 },
  ],
  f10: [
    { kind: 'text', field: 'f10Reference', label: 'F10 reference', min: 2 },
  ],
  /*
   * FIRST AIDERS ARE REQUIRED HERE, not on the emergency step.
   *
   * The requirement is emergency provision — but a first aider is a SiteKeyPerson
   * row entered on THIS step, and a red status on a screen with no field to fix
   * it is a dead end. The requirement lives where the data is entered; the
   * emergency step covers the arrangements themselves.
   */
  people: [
    { kind: 'count', of: 'siteManagers', label: 'At least one site manager' },
    { kind: 'count', of: 'firstAiders', label: 'At least one first aider' },
  ],
  emergency: [
    { kind: 'text', field: 'fireAssemblyPoint', label: 'Fire assembly point', min: 3 },
    { kind: 'text', field: 'emergencyProcedures', label: 'Emergency procedures' },
    { kind: 'text', field: 'nearestHospital', label: 'Nearest A&E', min: 3 },
  ],
  welfare: [
    { kind: 'text', field: 'welfareFacilities', label: 'Welfare facilities' },
    { kind: 'text', field: 'workingHours', label: 'Working hours', min: 5 },
  ],
  /*
   * SITE RULES COME FROM THE LIBRARY, not from the free-text field.
   *
   * This step edits `SiteInformation.siteRules`, which is supplementary notes —
   * it was renamed to "Additional site information" for exactly that reason.
   * The rules an operative is shown and acknowledges are SITE_RULE checklist
   * items, so those are what a complete plan needs. Requiring supplementary
   * notes instead would let a site with ten published rules read as incomplete,
   * and a site with none read as complete.
   */
  rules: [
    { kind: 'count', of: 'siteRules', label: 'At least one published site rule' },
  ],
  hazards: [
    { kind: 'text', field: 'siteHazards', label: 'Site-specific hazards' },
  ],
  'high-risk': [
    { kind: 'text', field: 'highRiskActivities', label: 'High-risk activities' },
  ],
  'temporary-works': [
    { kind: 'text', field: 'temporaryWorks', label: 'Temporary works' },
  ],
  access: [
    { kind: 'text', field: 'accessEgress', label: 'Site access and egress' },
  ],
  traffic: [
    { kind: 'text', field: 'trafficManagement', label: 'Traffic management' },
  ],
  utilities: [
    { kind: 'text', field: 'utilitiesIsolation', label: 'Utilities and isolation points' },
  ],
  environment: [
    { kind: 'text', field: 'environmentalControls', label: 'Environmental controls' },
  ],
};

/** Steps with no requirements are never `cppRequired` — they cannot gate a plan. */
export function requirementsFor(stepKey: string): Requirement[] {
  return REQUIREMENTS[stepKey] ?? [];
}

function met(req: Requirement, snap: SetupSnapshot, stepKey: string): boolean {
  const v = snap.values[stepKey] ?? {};
  switch (req.kind) {
    case 'text':
      return req.min === undefined ? hasSubstance(v[req.field]) : hasSubstance(v[req.field], req.min);
    case 'date':
      return hasDate(v[req.field]);
    case 'answered':
      return isAnswered(v[req.field]);
    case 'either':
      return req.fields.some((f) => hasShortValue(v[f]));
    case 'count':
      return snap.counts[req.of] > 0;
  }
}

export interface StepStatus {
  key: string;
  status: SectionStatus;
  /** Labels of the requirements not yet met, for the "still needed" hint. */
  missing: string[];
  /** How many requirements this step has at all. */
  total: number;
  /**
   * Whether this step contributes to the percentage.
   *
   * A step with no required information cannot be incomplete, but counting it
   * as complete is how a BLANK site reported 15% — the two optional steps were
   * free marks. They are excluded from the measure instead: the figure answers
   * "of the sections that need information, how many have it", which is the only
   * reading that starts at 0 and means something at 100.
   */
  measurable: boolean;
}

/**
 * One section's real state.
 *
 * A step with NO requirements is COMPLETE — there is nothing outstanding about
 * it. Those steps are never `cppRequired`, so this cannot inflate cppReady.
 */
export function stepStatus(stepKey: string, snap: SetupSnapshot): StepStatus {
  const reqs = requirementsFor(stepKey);
  if (reqs.length === 0) {
    // Nothing required, so nothing outstanding — but not a free mark either.
    return { key: stepKey, status: 'COMPLETE', missing: [], total: 0, measurable: false };
  }
  const missing = reqs.filter((r) => !met(r, snap, stepKey)).map((r) => r.label);
  const status: SectionStatus =
    missing.length === 0
      ? 'COMPLETE'
      : missing.length === reqs.length
        ? 'EMPTY'
        : 'PARTIAL';
  return { key: stepKey, status, missing, total: reqs.length, measurable: true };
}

export interface DerivedCompleteness {
  /** Sections that require information — the denominator of `percent`. */
  applicable: number;
  completed: number;
  percent: number;
  /** Applicable steps that are not COMPLETE. */
  outstanding: { key: string; title: string; status: SectionStatus; missing: string[] }[];
  /** Every applicable step's status, for the wizard's badges. */
  statuses: Record<string, StepStatus>;
  /** Every applicable step required for a CPP is COMPLETE. */
  cppReady: boolean;
  /** Steps the user has marked reviewed — tracking only, never completion. */
  reviewed: string[];
  /**
   * Reviewed but NOT complete. Surfaced deliberately: these are the sections
   * somebody previously ticked through, and they are exactly what the old model
   * was hiding.
   */
  reviewedButIncomplete: string[];
}

/**
 * PERCENT COUNTS COMPLETE SECTIONS ONLY.
 *
 * Part-credit for PARTIAL was considered and rejected: a half-filled section is
 * not half a plan, and giving it half a mark is how a comfortable-but-false
 * number comes back. PARTIAL is visible per-section instead, where it is
 * actionable.
 */
export function computeDerivedCompleteness(
  flags: Partial<Record<SetupFlag, boolean>>,
  snap: SetupSnapshot,
  reviewedSteps: string[],
): DerivedCompleteness {
  const applicable = applicableSteps(flags);
  const statuses: Record<string, StepStatus> = {};
  for (const step of applicable) statuses[step.key] = stepStatus(step.key, snap);

  const outstanding = applicable
    .filter((s) => statuses[s.key]!.status !== 'COMPLETE')
    .map((s) => ({
      key: s.key,
      title: s.title,
      status: statuses[s.key]!.status,
      missing: statuses[s.key]!.missing,
    }));

  // Only measurable steps count, so a blank site reads 0% rather than being
  // handed the optional steps for free.
  const measurable = applicable.filter((s) => statuses[s.key]!.measurable);
  const completed = measurable.filter(
    (s) => statuses[s.key]!.status === 'COMPLETE',
  ).length;
  const reviewed = reviewedSteps.filter((k) => statuses[k] !== undefined);

  return {
    applicable: measurable.length,
    completed,
    percent: measurable.length === 0 ? 0 : Math.round((completed / measurable.length) * 100),
    outstanding,
    statuses,
    cppReady: applicable
      .filter((s) => s.cppRequired)
      .every((s) => statuses[s.key]!.status === 'COMPLETE'),
    reviewed,
    reviewedButIncomplete: reviewed.filter((k) => statuses[k]!.status !== 'COMPLETE'),
  };
}

/** Every step key that carries requirements — for tests and for the wizard. */
export const STEPS_WITH_REQUIREMENTS = SETUP_STEPS.filter(
  (s) => requirementsFor(s.key).length > 0,
).map((s) => s.key);
