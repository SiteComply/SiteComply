import { PlatformRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Report-export audit logging (UK-GDPR accountability). Every successful export
 * writes one row. Viewing the log is Admin-only (see docs/REPORTS.md §9); the
 * read helper is provided for the Admin surface built in a later phase.
 */

export interface ReportExportLogInput {
  platformUserId: string;
  role: PlatformRole;
  reportType: string;
  format: string; // "csv"
  siteIds: string[];
  dateFrom?: Date | null;
  dateTo?: Date | null;
  rowCount: number;
}

export function logReportExport(input: ReportExportLogInput) {
  return prisma.reportExportLog.create({
    data: {
      platformUserId: input.platformUserId,
      role: input.role,
      reportType: input.reportType,
      format: input.format,
      siteIds: input.siteIds,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
      rowCount: input.rowCount,
    },
  });
}

/** Recent export-log entries for the Admin-only audit view (later phase). */
export function listReportExportLogs(limit = 100) {
  return prisma.reportExportLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      platformUser: { select: { name: true, email: true, company: true } },
    },
  });
}
