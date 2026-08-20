import type { PlatformIconName } from '@/components/platform/icons';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/**
 * The catalogue of v1 report types. Client-safe data (no Prisma/server imports)
 * so both the landing page and the future report/export routes share one source
 * of truth. Each report's data rendering & CSV export are built in later phases;
 * Phase 0 only needs the metadata that drives visibility, scope and export gating.
 */

export interface ReportType {
  /** Stable id, used in the route and the export audit log. */
  id: string;
  title: string;
  description: string;
  icon: PlatformIconName;
  /** Only Directors (organisation-wide) can run this report. */
  directorOnly: boolean;
  /** Contains worker-level personal data (drives Client aggregate-only + GDPR). */
  personalData: boolean;
  /** Clients see aggregate-only (counts/summaries), never worker-level rows. */
  clientAggregateOnly: boolean;
  /**
   * Optional override: only these roles may EXPORT this report (in addition to
   * the general reports-export permission). Used to restrict CSCS detail.
   */
  exportRoles?: PlatformRoleValue[];
  /** Whether the report page is implemented (landing links it) or still upcoming. */
  built?: boolean;
}

/** Roles allowed to export detailed CSCS data (tighter than the general set). */
export const CSCS_EXPORT_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'SITE_MANAGER',
  'HS_CONSULTANT',
];

export const REPORT_TYPES: ReportType[] = [
  {
    id: 'attendance',
    title: 'Site Attendance',
    description:
      'Every check-in and check-out across your sites, with time on site.',
    icon: 'clipboard',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'compliance-activities',
    title: 'Compliance Activities',
    description:
      'Scheduled checks and inspections: what is due, overdue and completed.',
    icon: 'clipboard',
    directorOnly: false,
    // Occurrence-level rows name the assignee (a platform user or worker), so
    // this is treated as personal data and Clients see aggregates only, matching
    // every other report that identifies people.
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'permits',
    title: 'Permits to Work',
    description:
      'Permits to work requested on your sites, and how each was decided.',
    icon: 'permit',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'compliance',
    title: 'Compliance',
    description:
      'Induction completion, and the safety declarations workers accepted.',
    icon: 'shield',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'occupancy',
    title: 'On-Site Occupancy',
    description: 'Who is on site now, and how busy each site has been.',
    icon: 'hardhat',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'workforce',
    title: 'Workforce & Company',
    description: 'Attendance broken down by company and subcontractor.',
    icon: 'grid',
    directorOnly: false,
    personalData: false,
    clientAggregateOnly: false,
    built: true,
  },
  {
    id: 'cscs',
    title: 'CSCS / Competency',
    description:
      'Worker card types and competencies, with expired cards flagged.',
    icon: 'doc',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    exportRoles: CSCS_EXPORT_ROLES,
    built: true,
  },
  {
    id: 'scorecard',
    title: 'Site Compliance Scorecard',
    description: 'A compliance scorecard for each site, side by side.',
    icon: 'chart',
    directorOnly: false,
    personalData: false,
    clientAggregateOnly: false,
    built: true,
  },
  {
    id: 'org-overview',
    title: 'Organisation Overview',
    description: 'Company-wide totals and trends, with every site compared.',
    icon: 'chart',
    directorOnly: true,
    personalData: false,
    clientAggregateOnly: false,
    built: true,
  },
  {
    id: 'knowledge-checks',
    title: 'Knowledge Checks',
    description:
      'How workers scored on their induction questions, and which they flagged.',
    icon: 'shield',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
];

export function getReportType(id: string): ReportType | undefined {
  return REPORT_TYPES.find((r) => r.id === id);
}
