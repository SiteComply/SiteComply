/**
 * CPP Tier 3A — management arrangements.
 *
 * The six L153 Appendix 3 Section 2 items the Construction Phase Plan was
 * silent on. Two of them engage explicit Principal Contractor duties rather
 * than general guidance — preventing access by unauthorised persons, and
 * consulting workers — and in the access case SiteComply already ENFORCES the
 * thing the document failed to claim.
 *
 * ── WHY COMPANY-LEVEL, INHERITED ──────────────────────────────────────────
 *
 * Almost all of this is company policy, not site detail. How contractors are
 * selected, what happens after an incident, how workers are consulted — these
 * are the same on every site a Principal Contractor runs. A field per site would
 * mean authoring six documents seven times over and watching them drift.
 *
 * So arrangements are written ONCE at company level and inherited by every site.
 * A site overrides one only where it genuinely differs, and the plan says which
 * is which — a reviewer needs to know whether they are reading the standard or
 * something written for this project. That is also how real construction phase
 * plans are assembled: a company standard plus a site-specific annex.
 *
 * ── THE RISK THIS CARRIES ─────────────────────────────────────────────────
 *
 * Boilerplate. If every site inherits identical text the plan reads as generic,
 * which is a fair criticism of a lot of CPP software. Two things push against
 * it: the document labels standard vs site-specific rather than blurring them,
 * and `promptSiteSpecific` marks the arrangements where a site-specific version
 * is usually warranted, so the editor asks rather than letting the default pass
 * silently.
 *
 * Client-safe: no Prisma, no server imports. The editors are client components.
 */

export type ArrangementKeyValue =
  | 'HS_FILE'
  | 'MANAGEMENT_STRUCTURE'
  | 'WORKER_CONSULTATION'
  | 'CONTRACTOR_MANAGEMENT'
  | 'PUBLIC_PROTECTION'
  | 'INCIDENT_REPORTING';

export interface ArrangementMeta {
  /** Matches the ArrangementKey enum member in prisma/schema.prisma exactly. */
  key: ArrangementKeyValue;
  /** Section title, as it appears in the plan. */
  title: string;
  /** One line on why the section exists, for the editor. */
  purpose: string;
  /** What a construction phase plan is expected to say here. */
  guidance: string;
  /**
   * Whether a site-specific version is usually warranted. A DISPLAY prompt in
   * the editor only — it never blocks a save and never changes the CPP.
   */
  promptSiteSpecific: boolean;
}

/**
 * In the order they appear in the plan: who is responsible, then how people are
 * engaged and controlled, then how the site is protected, then what happens when
 * something goes wrong, then what is handed over at the end.
 */
export const CPP_ARRANGEMENTS: ArrangementMeta[] = [
  {
    key: 'MANAGEMENT_STRUCTURE',
    title: 'Management structure and responsibilities',
    purpose:
      'Who is responsible for health and safety on the project, and what for.',
    guidance:
      'Set out the management structure for the project, the health and safety responsibilities attaching to each role, reporting lines, and the health and safety objectives the project is managed against.',
    // Reporting lines and named responsibilities usually differ by project.
    promptSiteSpecific: true,
  },
  {
    key: 'WORKER_CONSULTATION',
    title: 'Consultation and engagement with workers',
    purpose:
      'How operatives are consulted and how they raise concerns. A specific duty under CDM 2015.',
    guidance:
      'Describe how workers are consulted on health and safety, how briefings and toolbox talks are delivered, how a worker raises a concern or stops unsafe work, and how the response is fed back to them.',
    promptSiteSpecific: false,
  },
  {
    key: 'CONTRACTOR_MANAGEMENT',
    title: 'Selection and management of contractors',
    purpose:
      'How contractors are assessed before appointment and controlled on site.',
    guidance:
      'Describe how contractors are assessed for competence and capability before appointment, what is required of them before they start (risk assessments, method statements, insurance, competence evidence), and how their work is monitored and coordinated on site.',
    promptSiteSpecific: false,
  },
  {
    key: 'PUBLIC_PROTECTION',
    title: 'Public protection and site security',
    purpose:
      'Preventing access by unauthorised persons, and protecting people outside the site. An explicit Principal Contractor duty.',
    guidance:
      'Describe the site boundary and how it is secured, signage, arrangements outside working hours, and the measures protecting members of the public, neighbouring occupiers and anyone else who could be affected by the work.',
    // Boundaries, neighbours and hoarding are the definition of site-specific.
    promptSiteSpecific: true,
  },
  {
    key: 'INCIDENT_REPORTING',
    title: 'Accident and incident reporting',
    purpose: 'What happens when something goes wrong, and who is told.',
    guidance:
      'Describe what must be reported and by whom, first aid arrangements, how accidents, near misses and dangerous occurrences are recorded and investigated, and the arrangements for reporting under RIDDOR.',
    promptSiteSpecific: false,
  },
  {
    key: 'HS_FILE',
    title: 'The health and safety file',
    purpose:
      'What is collected for the file during the works, and how it is handed over.',
    guidance:
      'Describe the format of the health and safety file, what will be included, who is responsible for collecting the information as the work proceeds, where it is held, and the arrangements for handing it to the client at the end of the project.',
    promptSiteSpecific: false,
  },
];

export function isArrangementKey(v: string): v is ArrangementKeyValue {
  return CPP_ARRANGEMENTS.some((a) => a.key === v);
}

export function arrangementMeta(key: string): ArrangementMeta | undefined {
  return CPP_ARRANGEMENTS.find((a) => a.key === key);
}

/** Where the text a site is using actually came from. */
export type ArrangementSource = 'SITE' | 'STANDARD' | 'NONE';

/** How the source reads in the printed plan. A reviewer needs to know. */
export function arrangementSourceLabel(source: ArrangementSource): string {
  if (source === 'SITE') return 'Site-specific';
  if (source === 'STANDARD') return 'Company standard';
  return 'Not recorded';
}
