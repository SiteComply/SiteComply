import type { BriefingSource } from '@/services/induction/inductionBriefing';
import { isMeaningful } from '@/services/induction/inductionBriefing';

/**
 * WHICH SCENES A SITE'S INDUCTION VIDEO MUST CONTAIN, decided by the site's own
 * records and nothing else.
 *
 * ── WHY A RULES ENGINE AND NOT A PROMPT ───────────────────────────────────
 *
 * Handing every field to a model and asking it what matters puts the safety
 * judgement in the model. It would be free to omit asbestos on a quiet day and
 * to invent a muster point on a busy one. So the decision is made HERE, from
 * structured data, and the model's only job is to say the resulting facts in
 * plain English. Whether a scene appears is arithmetic; how it reads is writing.
 *
 * ── REQUIRED, OPTIONAL, AND BLOCKED ───────────────────────────────────────
 *
 *   required   the site's data says this scene MUST be in the induction. It
 *              cannot be deleted by an editor.
 *   optional   there is content worth saying, but its absence is not a failure.
 *   blocked    a required scene has no usable facts behind it. Generation stops
 *              and names what is missing, rather than producing a video that
 *              sounds complete and is not.
 *
 * "Usable" is the same test the induction briefing applies: an entry of "N/A",
 * "TBC", or a question left in the box is not an answer (see isMeaningful).
 *
 * ── PHASE 1 USES EXISTING FIELDS ONLY ─────────────────────────────────────
 *
 * By the owner's decision there is no new occupancy flag and no muster-point
 * record: the emergency information and assembly point already held are what
 * these rules read. Scenes the specification frames around those future fields
 * are derived from what exists - an occupied-site scene from the site's own
 * hazard text, a muster-point scene from the assembly point.
 */

export type SceneType =
  | 'WELCOME'
  | 'PROJECT_OVERVIEW'
  | 'SITE_TEAM'
  | 'WORKING_HOURS'
  | 'WELFARE'
  | 'ACCESS_EGRESS'
  | 'DELIVERIES'
  | 'TRAFFIC_PEDESTRIAN'
  | 'SITE_MAP'
  | 'EMERGENCY_PROCEDURES'
  | 'FIRE_MUSTER_POINT'
  | 'FIRST_AID'
  | 'EMERGENCY_CONTACTS'
  | 'INCIDENT_REPORTING'
  | 'SITE_HAZARDS'
  | 'EXISTING_RISKS'
  | 'HIGH_RISK_ACTIVITIES'
  | 'PERMITS'
  | 'TEMPORARY_WORKS'
  | 'SERVICES_ISOLATION'
  | 'ENVIRONMENTAL'
  | 'ASBESTOS'
  | 'WORK_AT_HEIGHT'
  | 'SIGNIFICANT_RISKS'
  | 'RAMS'
  | 'SITE_RULES'
  | 'PPE'
  | 'CLOSING'
  /** A company induction module. Its words are authored, not generated. */
  | 'COMPANY_MODULE';

export interface SceneRequirement {
  sceneType: SceneType;
  /** Shown as the scene's title; the model may not change it. */
  heading: string;
  /** Required scenes cannot be removed by an editor. */
  required: boolean;
  /** Field paths behind this scene, so a reviewer can check a sentence. */
  sourceRefs: string[];
  /** The verified facts, in the order they should be narrated. */
  facts: string[];
  /** Phase 2/3: which branded template renders it. */
  visualTemplate: string;

  /*
   * ── WHERE THIS SCENE CAME FROM ──────────────────────────────────────────
   *
   * SITE     derived from this project's own records. The model turns its
   *          facts into narration.
   * MODULE   company standard content, issued by a Director. Its words are
   *          ALREADY WRITTEN and are never sent to the model - it cannot
   *          re-phrase company policy, the scene costs no tokens, and what an
   *          operative hears is exactly what was approved.
   */
  source: SceneSource;
  /** MODULE scenes only: the issued revision whose words these are. */
  moduleRevisionId?: string;
  /** MODULE scenes only: the authored narration, used verbatim. */
  narration?: string;
  /** MODULE scenes only: this project has departed from the company text. */
  overridden?: boolean;

  /**
   * Sort key. Site scenes take their place from SCENE_ORDER; company modules
   * form a band between the project's own content and the closing scenes, each
   * ordered within the band by the module's own `order`.
   */
  orderKey: number;
}

export type SceneSource = 'SITE' | 'MODULE';

/** A company module, already resolved for this project. */
export interface ResolvedModuleScene {
  moduleId: string;
  slug: string;
  title: string;
  order: number;
  revisionId: string;
  version: number;
  heading: string;
  narration: string;
  replacesSceneType: string | null;
  overridden: boolean;
  overrideReason: string | null;
}

export interface MissingRequirement {
  sceneType: SceneType;
  heading: string;
  /** What a manager must enter, in their words, and where. */
  message: string;
}

export interface SceneManifest {
  scenes: SceneRequirement[];
  /** Required scenes with nothing usable behind them. Non-empty = blocked. */
  missing: MissingRequirement[];
  /** Worth saying, not worth blocking for. */
  warnings: string[];
  /** True when a script may be generated. */
  canGenerate: boolean;
}

/** Everything the rules read. The briefing's own source, plus rules and PPE. */
export interface VideoSource extends BriefingSource {
  /**
   * Company induction modules already resolved for this project — included,
   * excluded or overridden — by resolveModulesForSite. The rules engine does
   * not decide WHICH modules apply (that is company policy plus a site's own
   * decision); it decides where they sit and whether the project's own records
   * displace one.
   */
  modules: ResolvedModuleScene[];
  siteRules: string[];
  ppe: string[];
}

const t = (v: string | null | undefined): string | null =>
  isMeaningful(v) ? (v as string).trim() : null;

/**
 * What the rules below write. `source` and `orderKey` are stamped centrally by
 * `push` rather than repeated on thirty literals - and stamping them in one
 * place is also what stops a site scene ever being mislabelled as a company
 * module, which is the distinction the whole feature rests on.
 */
type SiteSceneDraft = Omit<SceneRequirement, 'source' | 'orderKey'>;

/** A scene that only exists when it has something to say. */
function optional(
  sceneType: SceneType,
  heading: string,
  visualTemplate: string,
  entries: [string, string | null][],
): SiteSceneDraft | null {
  const facts = entries.filter(([, v]) => v).map(([, v]) => v as string);
  const refs = entries.filter(([, v]) => v).map(([ref]) => ref);
  if (facts.length === 0) return null;
  return { sceneType, heading, required: false, sourceRefs: refs, facts, visualTemplate };
}

export function buildSceneManifest(src: VideoSource): SceneManifest {
  const scenes: SceneRequirement[] = [];
  const missing: MissingRequirement[] = [];
  const warnings: string[] = [];
  const info = src.info;
  const push = (s: SiteSceneDraft | null) => {
    if (!s) return;
    scenes.push({
      ...s,
      source: 'SITE',
      // Site scenes take their place from the running order below; the * 1000
      // leaves room for the company band to sit between two of them.
      orderKey: SCENE_ORDER.indexOf(s.sceneType) * 1000,
    });
  };

  /*
   * REQUIRED, ALWAYS. An induction that does not say where it is, what to do in
   * an emergency, or where to muster is not an induction. These three block.
   */
  push({
    sceneType: 'WELCOME',
    heading: 'Welcome to this site',
    required: true,
    sourceRefs: ['siteName', 'address', 'jobReference'],
    facts: [
      `This induction is for ${src.siteName}.`,
      `The site is at ${src.address}.`,
      ...(t(src.duty?.principalContractor)
        ? [`The principal contractor is ${src.duty?.principalContractor}.`]
        : []),
    ],
    visualTemplate: 'brand-welcome',
  });

  const emergency = t(info.emergencyProcedures);
  if (emergency) {
    push({
      sceneType: 'EMERGENCY_PROCEDURES',
      heading: 'In an emergency',
      required: true,
      sourceRefs: ['info.emergencyProcedures'],
      facts: [emergency],
      visualTemplate: 'alert-full',
    });
  } else {
    missing.push({
      sceneType: 'EMERGENCY_PROCEDURES',
      heading: 'In an emergency',
      message:
        'No emergency procedures are recorded for this site. Add them in Project setup → Emergency arrangements before generating the induction.',
    });
  }

  /*
   * THE MUSTER POINT, from the assembly point already held. The specification
   * frames this around a muster-point record; the owner's decision is to use the
   * existing field, so that is what is required here.
   */
  const assembly = t(src.emergency.fireAssemblyPoint);
  if (assembly) {
    push({
      sceneType: 'FIRE_MUSTER_POINT',
      heading: 'Fire and the assembly point',
      required: true,
      sourceRefs: ['emergency.fireAssemblyPoint', 'info.fireArrangements'],
      facts: [
        `The assembly point is ${assembly}.`,
        ...(t(info.fireArrangements) ? [t(info.fireArrangements) as string] : []),
      ],
      visualTemplate: 'map-point',
    });
  } else {
    missing.push({
      sceneType: 'FIRE_MUSTER_POINT',
      heading: 'Fire and the assembly point',
      message:
        'No fire assembly point is recorded for this site. Add it in Project setup → Emergency arrangements before generating the induction.',
    });
  }

  /*
   * FIRST AID is required because an operative must know who to find. The
   * people come from the site's own records: the named first aider and anyone
   * listed as a first aider or fire marshal.
   */
  const firstAiders = src.keyPeople
    .filter((p) => p.kind === 'FIRST_AIDER' || p.kind === 'FIRE_MARSHAL')
    .filter((p) => t(p.name));
  const namedAider = t(src.emergency.firstAiderName);
  if (firstAiders.length > 0 || namedAider) {
    const facts: string[] = [];
    if (namedAider) {
      facts.push(
        `The first aider is ${namedAider}${
          t(src.emergency.firstAiderLocation) ? `, based at ${t(src.emergency.firstAiderLocation)}` : ''
        }.`,
      );
    }
    for (const p of firstAiders) {
      if (namedAider && p.name.trim().toLowerCase() === namedAider.toLowerCase()) continue;
      facts.push(
        `${p.name.trim()} is a ${p.kind === 'FIRE_MARSHAL' ? 'fire marshal' : 'first aider'}${
          t(p.location) ? `, based at ${t(p.location)}` : ''
        }.`,
      );
    }
    push({
      sceneType: 'FIRST_AID',
      heading: 'First aid',
      required: true,
      sourceRefs: ['emergency.firstAiderName', 'keyPeople'],
      facts,
      visualTemplate: 'people-card',
    });
  } else {
    missing.push({
      sceneType: 'FIRST_AID',
      heading: 'First aid',
      message:
        'No first aider is recorded for this site. Add one in Project setup → Site personnel before generating the induction.',
    });
  }

  /*
   * REQUIRED BY WHAT THE SITE SAYS ABOUT ITSELF. A hazard the register marks as
   * applying must be narrated, and must have controls written for it - a scene
   * naming a hazard with no control is worse than no scene.
   */
  const riskRule: { match: RegExp; sceneType: SceneType; heading: string; template: string }[] = [
    { match: /asbestos/i, sceneType: 'ASBESTOS', heading: 'Asbestos', template: 'alert-full' },
    { match: /falls|height/i, sceneType: 'WORK_AT_HEIGHT', heading: 'Working at height', template: 'alert-full' },
  ];
  for (const rule of riskRule) {
    const risk = src.risks.find((r) => rule.match.test(r.label));
    if (!risk) continue;
    const controls = t(risk.controls);
    if (controls) {
      push({
        sceneType: rule.sceneType,
        heading: rule.heading,
        required: true,
        sourceRefs: [`risks.${rule.sceneType}`],
        facts: [`${risk.label} applies on this site.`, controls],
        visualTemplate: rule.template,
      });
    } else {
      missing.push({
        sceneType: rule.sceneType,
        heading: rule.heading,
        message: `${risk.label} is recorded as applying to this site, but no control measures have been entered. Add them in Project setup → Hazards and existing risks before generating the induction.`,
      });
    }
  }

  // The rest of the significant risks, narrated together.
  const otherRisks = src.risks.filter(
    (r) => !riskRule.some((rule) => rule.match.test(r.label)) && t(r.controls),
  );
  if (otherRisks.length > 0) {
    push({
      sceneType: 'SIGNIFICANT_RISKS',
      heading: 'Significant risks and controls',
      required: true,
      sourceRefs: ['risks'],
      facts: otherRisks.map((r) => `${r.label}: ${t(r.controls)}`),
      visualTemplate: 'list-risks',
    });
  }
  const riskNoControls = src.risks.filter(
    (r) => !riskRule.some((rule) => rule.match.test(r.label)) && !t(r.controls),
  );
  for (const r of riskNoControls) {
    warnings.push(
      `${r.label} is marked as applying but has no control measures recorded, so it is not in the induction.`,
    );
  }

  /*
   * SITE RULES AND PPE are required whenever the site publishes them: they are
   * what an operative agrees to, so the video must say them.
   */
  if (src.siteRules.length > 0) {
    push({
      sceneType: 'SITE_RULES',
      heading: 'Site rules',
      required: true,
      sourceRefs: ['siteRules'],
      facts: src.siteRules,
      visualTemplate: 'list-rules',
    });
  } else {
    warnings.push('No site rules are published for this site, so the induction has no rules scene.');
  }
  if (src.ppe.length > 0) {
    push({
      sceneType: 'PPE',
      heading: 'PPE you must wear',
      required: true,
      sourceRefs: ['ppe'],
      facts: src.ppe,
      visualTemplate: 'list-ppe',
    });
  } else {
    warnings.push('No PPE requirements are set for this site, so the induction has no PPE scene.');
  }

  // Everything else appears when the site has something to say.
  push(optional('PROJECT_OVERVIEW', 'About the work', 'text-full', [
    ['project.description', t(src.project?.description)],
    ['project.scopeOfWorks', t(src.project?.scopeOfWorks)],
    ['inductionNotes', t(src.inductionNotes)],
  ]));
  push(optional('SITE_TEAM', 'Your site team', 'people-card',
    src.siteManager && t(src.siteManager.name)
      ? [['siteManager', `The site manager is ${t(src.siteManager.name)}.`]]
      : []));
  push(optional('WORKING_HOURS', 'Working hours', 'text-card', [['info.workingHours', t(info.workingHours)]]));
  push(optional('WELFARE', 'Welfare facilities', 'text-card', [['info.welfareFacilities', t(info.welfareFacilities)]]));
  push(optional('ACCESS_EGRESS', 'Getting on and off site', 'text-card', [['info.accessEgress', t(info.accessEgress)]]));
  push(optional('DELIVERIES', 'Deliveries', 'text-card', [['info.deliveryProcedures', t(info.deliveryProcedures)]]));
  push(optional('TRAFFIC_PEDESTRIAN', 'Traffic and pedestrian routes', 'alert-card', [
    ['info.trafficManagement', t(info.trafficManagement)],
  ]));
  push(optional('SITE_HAZARDS', 'Hazards on this site', 'alert-card', [['info.siteHazards', t(info.siteHazards)]]));
  push(optional('EXISTING_RISKS', 'Existing site risks', 'alert-card', [['info.existingSiteRisks', t(info.existingSiteRisks)]]));
  push(optional('HIGH_RISK_ACTIVITIES', 'High-risk activities', 'alert-card', [
    ['info.highRiskActivities', t(info.highRiskActivities)],
  ]));
  push(optional('TEMPORARY_WORKS', 'Temporary works', 'text-card', [['info.temporaryWorks', t(info.temporaryWorks)]]));
  push(optional('SERVICES_ISOLATION', 'Services and isolation', 'alert-card', [
    ['info.utilitiesIsolation', t(info.utilitiesIsolation)],
  ]));
  push(optional('ENVIRONMENTAL', 'Environmental controls', 'text-card', [
    ['info.environmentalControls', t(info.environmentalControls)],
  ]));
  push(optional('INCIDENT_REPORTING', 'Reporting accidents and near misses', 'text-card', [
    ['incidentReporting', t(src.incidentReporting)],
  ]));
  push(optional('EMERGENCY_CONTACTS', 'Emergency contacts', 'people-card', [
    ['emergency.emergencyNumber', t(src.emergency.emergencyNumber) ? `The emergency number is ${t(src.emergency.emergencyNumber)}.` : null],
    ['emergency.nearestHospital', t(src.emergency.nearestHospital) ? `The nearest hospital is ${t(src.emergency.nearestHospital)}.` : null],
  ]));
  if (src.permitTypes.length > 0) {
    push({
      sceneType: 'PERMITS',
      heading: 'Work that needs a permit',
      required: false,
      sourceRefs: ['permitTypes'],
      facts: src.permitTypes,
      visualTemplate: 'list-permits',
    });
  }
  if (src.ramsDocuments.length > 0) {
    push({
      sceneType: 'RAMS',
      heading: 'Risk assessments and method statements',
      required: false,
      sourceRefs: ['ramsDocuments'],
      facts: [
        `${src.ramsDocuments.length} risk assessment${src.ramsDocuments.length === 1 ? '' : 's'} and method statement${src.ramsDocuments.length === 1 ? '' : 's'} apply to this site and must be read before starting work.`,
      ],
      visualTemplate: 'list-docs',
    });
  } else {
    warnings.push('No RAMS are uploaded for this site, so the induction cannot point to any.');
  }
  if (info.hasSiteMap) {
    push({
      sceneType: 'SITE_MAP',
      heading: 'The site layout',
      required: false,
      sourceRefs: ['info.siteMap'],
      facts: ['The site layout plan shows the areas described in this induction.'],
      visualTemplate: 'media-full',
    });
  }

  push({
    sceneType: 'CLOSING',
    heading: 'Before you start work',
    required: true,
    sourceRefs: [],
    facts: [
      'Ask your site manager if anything in this induction is unclear.',
      'Stop work and report it if conditions become unsafe.',
    ],
    visualTemplate: 'brand-close',
  });

  /*
   * ── COMPANY MODULES ──────────────────────────────────────────────────────
   *
   * Already resolved for this project (included, excluded or overridden) before
   * the rules engine sees them. Two things happen here and nowhere else:
   *
   * 1. THE PROJECT'S OWN WORDS WIN. When a module covers ground the site has
   *    recorded its own arrangement for - accident reporting is the one that
   *    does this today - the module is left out, because hearing the same
   *    subject twice in one induction teaches an operative that half of it can
   *    be ignored. The manager is told which module was dropped and why.
   * 2. THEY ARE NEVER "MISSING". A module carries its own words, so it can
   *    never block generation the way an unanswered site field does.
   */
  const emitted = new Set(scenes.map((s) => s.sceneType));
  for (const m of src.modules) {
    if (m.replacesSceneType && emitted.has(m.replacesSceneType as SceneType)) {
      warnings.push(
        `“${m.title}” was left out: this project records its own arrangement for it, and that is what the induction says.`,
      );
      continue;
    }
    scenes.push({
      sceneType: 'COMPANY_MODULE',
      heading: m.heading,
      // A company standard is not a site's to drop, the same way a required
      // site scene is not. Excluding one happens at the project's settings,
      // with a reason, not in the script editor.
      required: true,
      sourceRefs: [`module.${m.slug}`],
      facts: [],
      visualTemplate: 'brand-standard',
      source: 'MODULE',
      moduleRevisionId: m.revisionId,
      narration: m.narration,
      overridden: m.overridden,
      orderKey: companyBandOrderKey(m.order),
    });
    if (m.overridden) {
      warnings.push(
        `“${m.title}” has been changed for this project and no longer matches the company standard${m.overrideReason ? `: ${m.overrideReason}` : '.'}`,
      );
    }
  }

  return {
    scenes: orderScenes(scenes),
    missing,
    warnings,
    canGenerate: missing.length === 0,
  };
}

/**
 * The order an induction is given in: where you are, what to do when it goes
 * wrong, who helps, what can hurt you, what you agreed to, then the close.
 * Fixed here rather than left to the model, which has no reason to prefer one.
 */
const SCENE_ORDER: SceneType[] = [
  'WELCOME',
  'PROJECT_OVERVIEW',
  'SITE_TEAM',
  'WORKING_HOURS',
  'WELFARE',
  'ACCESS_EGRESS',
  'DELIVERIES',
  'TRAFFIC_PEDESTRIAN',
  'SITE_MAP',
  'EMERGENCY_PROCEDURES',
  'FIRE_MUSTER_POINT',
  'FIRST_AID',
  'EMERGENCY_CONTACTS',
  'INCIDENT_REPORTING',
  'ASBESTOS',
  'WORK_AT_HEIGHT',
  'SITE_HAZARDS',
  'EXISTING_RISKS',
  'HIGH_RISK_ACTIVITIES',
  'SIGNIFICANT_RISKS',
  'TEMPORARY_WORKS',
  'SERVICES_ISOLATION',
  'ENVIRONMENTAL',
  'PERMITS',
  'RAMS',
  'SITE_RULES',
  'PPE',
  'CLOSING',
];

/**
 * WHERE THE COMPANY BAND SITS, by the owner's decision: after the project's own
 * hazards, emergency arrangements and paperwork, and before site rules, PPE and
 * the close.
 *
 * An operative hears where they are and what is dangerous HERE first, because
 * that is what they cannot get anywhere else; the standards that apply on every
 * site follow, and the induction ends on what to wear and where to go.
 */
const COMPANY_BAND_AFTER: SceneType = 'RAMS';

function companyBandOrderKey(moduleOrder: number): number {
  // Between RAMS and SITE_RULES. The * 1000 on site scenes leaves exactly this
  // room, and the module's own order decides the sequence within the band.
  return SCENE_ORDER.indexOf(COMPANY_BAND_AFTER) * 1000 + 500 + moduleOrder;
}

function orderScenes(scenes: SceneRequirement[]): SceneRequirement[] {
  return scenes.slice().sort((a, b) => a.orderKey - b.orderKey);
}

/**
 * A fingerprint of the facts a script was generated from.
 *
 * Not of the whole site record: a manager renaming a document or correcting a
 * phone number nobody narrates should not mark a video stale. It covers exactly
 * what reached the scenes.
 */
export function manifestHash(manifest: SceneManifest): string {
  /*
   * THE MODULE REVISION IS PART OF THE FINGERPRINT. Issuing a new revision of a
   * company module changes what every induction should say, so every video
   * carrying it must read as out of date - which it does, for free, because
   * staleness is already "the manifest no longer hashes to what this version
   * was built from".
   */
  const payload = manifest.scenes
    .map((s) => [s.sceneType, s.heading, s.facts, s.moduleRevisionId ?? '', s.narration ?? ''].join('|'))
    .join('||');
  let h = 0;
  for (let i = 0; i < payload.length; i++) {
    h = (h * 31 + payload.charCodeAt(i)) | 0;
  }
  return `m${(h >>> 0).toString(16)}`;
}
