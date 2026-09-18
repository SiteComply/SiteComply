/**
 * CPP Tier 2 — the significant-risk topics a construction phase plan must address.
 *
 * ── WHY A FIXED LIST AND NOT A TEXT BOX ───────────────────────────────────
 *
 * The CPP previously covered significant risks with three free-text fields:
 * site hazards, existing site risks and high-risk activities. A Principal
 * Contractor writing three paragraphs does not cover twenty-five topics, and
 * nothing prompted them to — so a plan could go out with no mention of asbestos,
 * lifting operations or contaminated land and look perfectly finished.
 *
 * This is HSE L153 Appendix 3, "Arrangements for controlling significant site
 * risks", reproduced as an explicit list. The value is the PROMPT: a PC cannot
 * accidentally omit a topic the form asks about. That is the whole difference
 * between a plan that looks professional and one that is.
 *
 * ── APPLICABLE / NOT APPLICABLE IS AN ANSWER ──────────────────────────────
 *
 * Every topic has three states: unanswered, does not apply, applies. "Does not
 * apply" is a recorded decision by a named person, which is materially different
 * from silence — it is the difference between "we considered diving operations
 * and there are none" and "nobody thought about it". Controls are required only
 * where a topic applies.
 *
 * ── commonlyApplicable ────────────────────────────────────────────────────
 *
 * A DISPLAY hint only, never a default answer. Twenty-five topics is a long form,
 * and the rare ones (diving, caissons, explosives) would make it feel absurd on a
 * domestic refurbishment. Those collapse behind "less common risks" so the list
 * reads at a sensible length — but they are still present, still answerable and
 * still counted, because the sites that need them REALLY need them.
 *
 * Nothing here pre-answers anything. Seeding "not applicable" would recreate the
 * problem this replaces: a plan that looks considered because software filled it
 * in.
 */

export type RiskTopicKind = 'SAFETY' | 'HEALTH';

export interface RiskTopicMeta {
  /** Matches the RiskTopic enum member in prisma/schema.prisma exactly. */
  key: string;
  kind: RiskTopicKind;
  /** The topic as a duty holder would read it in the printed plan. */
  label: string;
  /** Shown under the label in the editor, to make the scope unambiguous. */
  hint?: string;
  /** Display grouping only — see the note above. Never a default answer. */
  commonlyApplicable: boolean;
}

/**
 * L153 Appendix 3, safety risks. Order follows the guidance rather than being
 * re-sorted by likelihood, so it can be checked against the source.
 */
const SAFETY: RiskTopicMeta[] = [
  {
    key: 'DELIVERY_REMOVAL_MATERIALS',
    kind: 'SAFETY',
    label: 'Delivery and removal of materials, waste and work equipment',
    hint: 'Including any risk to members of the public.',
    commonlyApplicable: true,
  },
  {
    key: 'SERVICES',
    kind: 'SAFETY',
    label: 'Dealing with services — water, electricity and gas',
    hint: 'Including overhead power lines, buried services and temporary electrical installations.',
    commonlyApplicable: true,
  },
  {
    key: 'ADJACENT_LAND_USE',
    kind: 'SAFETY',
    label: 'Accommodating adjacent land use',
    hint: 'Neighbouring occupiers, shared access, work over or next to a live building.',
    commonlyApplicable: true,
  },
  {
    key: 'STABILITY_OF_STRUCTURES',
    kind: 'SAFETY',
    label: 'Stability of structures during the works',
    hint: 'Temporary structures, and existing structures that are or may become unstable.',
    commonlyApplicable: true,
  },
  {
    key: 'PREVENTING_FALLS',
    kind: 'SAFETY',
    label: 'Preventing falls',
    hint: 'Work at height, edge protection, access equipment, openings and voids.',
    commonlyApplicable: true,
  },
  {
    key: 'FRAGILE_MATERIALS',
    kind: 'SAFETY',
    label: 'Work with or near fragile materials',
    hint: 'Roof lights, asbestos cement sheets, corroded decking.',
    commonlyApplicable: true,
  },
  {
    key: 'LIFTING_OPERATIONS',
    kind: 'SAFETY',
    label: 'Control of lifting operations',
    hint: 'Cranes, hoists, telehandlers, lifting accessories and the lift plan.',
    commonlyApplicable: true,
  },
  {
    key: 'PLANT_MAINTENANCE',
    kind: 'SAFETY',
    label: 'Maintenance of plant and equipment',
    hint: 'Inspection regimes, statutory examinations and defect reporting.',
    commonlyApplicable: true,
  },
  {
    key: 'EXCAVATIONS_GROUND',
    kind: 'SAFETY',
    label: 'Excavations and poor ground conditions',
    commonlyApplicable: true,
  },
  {
    key: 'TRAFFIC_PEDESTRIAN',
    kind: 'SAFETY',
    label: 'Traffic routes and segregation of vehicles and pedestrians',
    commonlyApplicable: true,
  },
  {
    key: 'STORAGE_OF_MATERIALS',
    kind: 'SAFETY',
    label: 'Storage of materials and work equipment',
    hint: 'Particularly hazardous or flammable materials.',
    commonlyApplicable: true,
  },
  {
    key: 'WELLS_TUNNELS',
    kind: 'SAFETY',
    label: 'Work on wells, underground earthworks and tunnels',
    commonlyApplicable: false,
  },
  {
    key: 'WORK_NEAR_WATER',
    kind: 'SAFETY',
    label: 'Work on or near water where there is a risk of drowning',
    commonlyApplicable: false,
  },
  {
    key: 'DIVING',
    kind: 'SAFETY',
    label: 'Work involving diving',
    commonlyApplicable: false,
  },
  {
    key: 'CAISSON_COMPRESSED_AIR',
    kind: 'SAFETY',
    label: 'Work in a caisson or compressed air working',
    commonlyApplicable: false,
  },
  {
    key: 'EXPLOSIVES',
    kind: 'SAFETY',
    label: 'Work involving explosives',
    commonlyApplicable: false,
  },
  {
    key: 'OTHER_SAFETY',
    kind: 'SAFETY',
    label: 'Any other significant safety risk',
    hint: 'Anything site-specific not covered above.',
    commonlyApplicable: true,
  },
];

/** L153 Appendix 3, health risks. */
const HEALTH: RiskTopicMeta[] = [
  {
    key: 'ASBESTOS',
    kind: 'HEALTH',
    label: 'Asbestos — survey, management and removal',
    hint: 'Required consideration for any building constructed before 2000.',
    commonlyApplicable: true,
  },
  {
    key: 'CONTAMINATED_LAND',
    kind: 'HEALTH',
    label: 'Dealing with contaminated land',
    commonlyApplicable: false,
  },
  {
    key: 'MANUAL_HANDLING',
    kind: 'HEALTH',
    label: 'Manual handling',
    commonlyApplicable: true,
  },
  {
    key: 'HAZARDOUS_SUBSTANCES',
    kind: 'HEALTH',
    label: 'Use of hazardous substances (COSHH)',
    hint: 'Including silica dust, and any substance needing health surveillance.',
    commonlyApplicable: true,
  },
  {
    key: 'NOISE_VIBRATION',
    kind: 'HEALTH',
    label: 'Reducing noise and hand-arm vibration',
    commonlyApplicable: true,
  },
  {
    key: 'IONISING_RADIATION',
    kind: 'HEALTH',
    label: 'Work with ionising radiation',
    commonlyApplicable: false,
  },
  {
    key: 'UV_RADIATION',
    kind: 'HEALTH',
    label: 'Exposure to ultraviolet radiation from the sun',
    commonlyApplicable: false,
  },
  {
    key: 'OTHER_HEALTH',
    kind: 'HEALTH',
    label: 'Any other significant health risk',
    commonlyApplicable: true,
  },
];

export const CPP_RISK_TOPICS: RiskTopicMeta[] = [...SAFETY, ...HEALTH];

export const SAFETY_TOPICS = SAFETY;
export const HEALTH_TOPICS = HEALTH;

export function isRiskTopicKey(v: string): boolean {
  return CPP_RISK_TOPICS.some((t) => t.key === v);
}

export function riskTopicMeta(key: string): RiskTopicMeta | undefined {
  return CPP_RISK_TOPICS.find((t) => t.key === key);
}

/** The three states a topic can be in, for display and for completion. */
export type RiskTopicAnswer = 'UNANSWERED' | 'NOT_APPLICABLE' | 'APPLIES';

export function answerFor(row: {
  applicable: boolean | null;
} | undefined): RiskTopicAnswer {
  if (!row || row.applicable === null) return 'UNANSWERED';
  return row.applicable ? 'APPLIES' : 'NOT_APPLICABLE';
}
