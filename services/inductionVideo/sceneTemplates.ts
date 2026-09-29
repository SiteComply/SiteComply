/**
 * WHAT EACH SCENE LOOKS LIKE — the visual language, in one place.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The specification asked for "24+ scene types mapped to reusable branded
 * animation assets". The scene types were built and the mapping never was:
 * `visualTemplate` was computed on every scene and then ignored by the renderer, so
 * all thirty types came out as the same static card with a different colour. The
 * result was, accurately, narrated slides.
 *
 * This registry is that missing mapping. It is deliberately DATA, not code: a
 * designer's decisions about pacing and emphasis belong somewhere a person can read
 * and change without touching a filter chain.
 *
 * ── THE COST MODEL DECIDES THE SHAPE ──────────────────────────────────────
 *
 * Measured on one core and calibrated against the B1 (fifteen seconds of static
 * video takes ninety-five seconds there):
 *
 *   static card + text              ~95s per 15s   the old behaviour
 *   ANIMATED text                  ~103s per 15s   +8%
 *   photograph with slow movement  ~210s per 15s   2.2x
 *   a PRECOMPUTED clip, copied        ~1s          free
 *
 * So motion comes from two places and almost never from a third: text animation,
 * which is nearly free, and precomputed branded clips, which are free. Per-frame
 * imagery is reserved for the few scenes that earn it, and is not part of this phase.
 *
 * No Prisma, no storage: this is a lookup table, read by the renderer and by the
 * caption builder, which must both agree on the running order.
 */

/**
 * A scene FAMILY, which is what a viewer actually perceives.
 *
 * Thirty scene types is a taxonomy for the rules engine. An operative watching the
 * video sees about seven kinds of thing, and the bumper that introduces each family
 * is what tells them which kind is coming.
 */
export type SceneFamily =
  | 'OPENING'
  | 'PROJECT'
  | 'EMERGENCY'
  | 'HAZARD'
  | 'ACCESS'
  | 'WELFARE'
  | 'STANDARDS'
  | 'CLOSING';

/** How the text arrives. Cheap, and the difference between film and slides. */
export type TextMotion =
  /** Heading settles into place, body fades up under it. The default. */
  | 'SETTLE'
  /** Lines arrive one after another — for lists a viewer should read in order. */
  | 'STAGGER'
  /** One fact, held large and still. Assembly points, telephone numbers. */
  | 'EMPHASIS'
  /** No movement at all. For a scene where stillness is the point. */
  | 'STILL';

/** A flat graphic accent drawn behind the text. `drawbox` — costs nothing. */
export type SceneAccent =
  | 'ALERT_BAR'
  | 'HAZARD_STRIPE'
  | 'BRAND_RULE'
  | null;

export interface SceneTemplate {
  family: SceneFamily;
  textMotion: TextMotion;
  accent: SceneAccent;
  /**
   * Show the family bumper before this scene?
   *
   * Only the FIRST scene of a run gets one — see `timeline.ts`. A bumper before
   * every hazard scene in a row would be a tic rather than a signpost.
   */
  bumper: boolean;
}

const T = (
  family: SceneFamily,
  textMotion: TextMotion,
  accent: SceneAccent = null,
  bumper = true,
): SceneTemplate => ({ family, textMotion, accent, bumper });

/**
 * Every scene type, deliberately exhaustive rather than defaulted.
 *
 * A new scene type must be given a treatment here, and the verification fails if one
 * is missing — that is the only way a template registry stays a design and does not
 * decay into "everything not listed looks generic".
 */
export const SCENE_TEMPLATES: Record<string, SceneTemplate> = {
  // ── The opening. Brand-led, and the only place the brand dominates. ──
  WELCOME: T('OPENING', 'SETTLE', 'BRAND_RULE'),
  PROJECT_OVERVIEW: T('PROJECT', 'SETTLE', 'BRAND_RULE'),
  SITE_TEAM: T('PROJECT', 'STAGGER', null, false),
  WORKING_HOURS: T('PROJECT', 'EMPHASIS', null, false),

  // ── Emergency. Held still and large: these are the facts somebody needs
  //    under pressure, and movement would work against reading them. ──
  EMERGENCY_PROCEDURES: T('EMERGENCY', 'STAGGER', 'ALERT_BAR'),
  FIRE_MUSTER_POINT: T('EMERGENCY', 'EMPHASIS', 'ALERT_BAR', false),
  FIRST_AID: T('EMERGENCY', 'EMPHASIS', 'ALERT_BAR', false),
  EMERGENCY_CONTACTS: T('EMERGENCY', 'EMPHASIS', 'ALERT_BAR', false),
  INCIDENT_REPORTING: T('EMERGENCY', 'SETTLE', 'ALERT_BAR', false),

  // ── Hazards. Striped, one thing at a time, never a wall of text. ──
  SITE_HAZARDS: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE'),
  EXISTING_RISKS: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE', false),
  HIGH_RISK_ACTIVITIES: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE', false),
  ASBESTOS: T('HAZARD', 'EMPHASIS', 'HAZARD_STRIPE'),
  WORK_AT_HEIGHT: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE', false),
  SIGNIFICANT_RISKS: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE', false),
  TEMPORARY_WORKS: T('HAZARD', 'SETTLE', 'HAZARD_STRIPE', false),
  SERVICES_ISOLATION: T('HAZARD', 'SETTLE', 'HAZARD_STRIPE', false),
  PERMITS: T('HAZARD', 'STAGGER', 'HAZARD_STRIPE', false),

  // ── Getting about. ──
  ACCESS_EGRESS: T('ACCESS', 'SETTLE'),
  DELIVERIES: T('ACCESS', 'SETTLE', null, false),
  TRAFFIC_PEDESTRIAN: T('ACCESS', 'STAGGER', null, false),
  // The map is the one scene built to hold an image. Until the image is wired
  // through it is still a card, and STILL is honest about that.
  SITE_MAP: T('ACCESS', 'STILL', null, false),

  // ── Looking after people. ──
  WELFARE: T('WELFARE', 'STAGGER'),
  ENVIRONMENTAL: T('WELFARE', 'SETTLE', null, false),

  // ── What is expected of everyone. ──
  SITE_RULES: T('STANDARDS', 'STAGGER', 'BRAND_RULE'),
  PPE: T('STANDARDS', 'STAGGER', 'BRAND_RULE', false),
  RAMS: T('STANDARDS', 'SETTLE', null, false),
  COMPANY_MODULE: T('STANDARDS', 'SETTLE', 'BRAND_RULE', false),

  // ── The close. ──
  CLOSING: T('CLOSING', 'SETTLE', 'BRAND_RULE'),

  /*
   * FOOTAGE IS NOT DRAWN AT ALL. A library segment is already a finished piece of
   * film: it takes no template, no text and no accent. It appears here so the
   * exhaustiveness check passes and so nobody concludes it was forgotten.
   */
  LIBRARY_SEGMENT: T('STANDARDS', 'STILL', null, false),
};

/** The treatment for a scene type. Unknown types get a safe, plain card. */
export function templateFor(sceneType: string): SceneTemplate {
  return SCENE_TEMPLATES[sceneType] ?? T('PROJECT', 'SETTLE', null, false);
}

/**
 * Does this scene type have a deliberate treatment, or is it falling through?
 *
 * Used by the verification to insist that every scene type the rules engine can
 * emit has been designed, rather than silently defaulted.
 */
export function hasTemplate(sceneType: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCENE_TEMPLATES, sceneType);
}

/*
 * ── THERE IS DELIBERATELY NO FAMILY→TONE MAP ──────────────────────────────
 *
 * The first version of this file had one, and the verification immediately found it
 * contradicting `toneForScene` in nine places. Those nine were not bugs in the old
 * code; they were considered decisions that a family-level rule is too coarse to
 * express:
 *
 *   FIRE_MUSTER_POINT, FIRST_AID, EMERGENCY_CONTACTS are SAFE, not ALERT - green,
 *     because an assembly point is where you GO to be safe. Painting it red would
 *     make the reassuring information look like the danger.
 *   SITE_RULES and PPE are SAFE - what to do, not what to fear.
 *   PROJECT_OVERVIEW is BRAND - the company introducing its own job.
 *
 * So the per-scene tone in sceneVisual stays authoritative for the CARD, and a family
 * decides only which BUMPER announces the section. The bumper carries its own colour,
 * chosen in scripts/build_brand_motion.sh, and the two are allowed to differ: a red
 * "IN AN EMERGENCY" title followed by a green assembly-point card is the right
 * sequence, not an inconsistency.
 */

/** A human label for the family, shown on its bumper. */
export const FAMILY_LABEL: Record<SceneFamily, string> = {
  OPENING: 'Welcome',
  PROJECT: 'This project',
  EMERGENCY: 'In an emergency',
  HAZARD: 'Hazards and controls',
  ACCESS: 'Getting around site',
  WELFARE: 'Welfare and environment',
  STANDARDS: 'What we expect',
  CLOSING: 'Before you start',
};
