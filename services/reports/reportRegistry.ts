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
    description: 'Check-in and check-out log across your sites over a date range.',
    icon: 'clipboard',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'compliance',
    title: 'Compliance',
    description:
      'Induction completion and PPE, site-rules, safe-working and GDPR acknowledgement rates.',
    icon: 'shield',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    built: true,
  },
  {
    id: 'occupancy',
    title: 'On-Site Occupancy',
    description: 'Live headcount now, plus peak and average occupancy per site.',
    icon: 'hardhat',
    directorOnly: false,
    personalData: false,
    clientAggregateOnly: true,
  },
  {
    id: 'workforce',
    title: 'Workforce & Company',
    description: 'Attendance broken down by company / subcontractor.',
    icon: 'grid',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
  },
  {
    id: 'cscs',
    title: 'CSCS / Competency',
    description: 'Workers by CSCS card type, with expired cards flagged.',
    icon: 'doc',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    exportRoles: CSCS_EXPORT_ROLES,
  },
  {
    id: 'cscs-expiring',
    title: 'Expiring CSCS Cards',
    description: 'CSCS cards expiring within 30, 60 or 90 days (and already expired).',
    icon: 'bolt',
    directorOnly: false,
    personalData: true,
    clientAggregateOnly: true,
    exportRoles: CSCS_EXPORT_ROLES,
  },
  {
    id: 'org-overview',
    title: 'Organisation Overview',
    description: 'Organisation-wide rollup and per-site comparison across all sites.',
    icon: 'chart',
    directorOnly: true,
    personalData: false,
    clientAggregateOnly: false,
  },
];

export function getReportType(id: string): ReportType | undefined {
  return REPORT_TYPES.find((r) => r.id === id);
}
