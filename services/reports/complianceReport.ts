import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Compliance report data. Scoped to `siteIds` (already within the viewer's
 * Assigned Sites) and the `checkedInAt` date range. `getComplianceSummary`
 * returns aggregate rates only (safe for Client); `getComplianceRows` returns
 * worker-level detail (non-Client views + CSV export).
 */

type Range = { gte?: Date; lt?: Date };

function where(siteIds: string[], range: Range) {
  return {
    jobSiteId: { in: siteIds },
    ...(range.gte || range.lt ? { checkedInAt: range } : {}),
  };
}

export interface ComplianceSummary {
  total: number;
  compliant: number;
  incomplete: number;
  ppe: number;
  rules: number;
  safe: number;
  gdpr: number;
  bySite: { name: string; compliant: number; total: number; pct: number }[];
}

export function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

/** Aggregate compliance/acknowledgement figures — no worker identities. */
export async function getComplianceSummary(
  siteIds: string[],
  range: Range,
): Promise<ComplianceSummary> {
  const empty: ComplianceSummary = {
    total: 0,
    compliant: 0,
    incomplete: 0,
    ppe: 0,
    rules: 0,
    safe: 0,
    gdpr: 0,
    bySite: [],
  };
  if (!siteIds.length) return empty;

  const subs = await prisma.submission.findMany({
    where: where(siteIds, range),
    select: {
      status: true,
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      jobSite: { select: { name: true } },
    },
  });

  const total = subs.length;
  const compliant = subs.filter((s) => s.status === SubmissionStatus.COMPLIANT).length;
  const bySiteMap = new Map<string, { compliant: number; total: number }>();
  for (const s of subs) {
    const m = bySiteMap.get(s.jobSite.name) ?? { compliant: 0, total: 0 };
    m.total += 1;
    if (s.status === SubmissionStatus.COMPLIANT) m.compliant += 1;
    bySiteMap.set(s.jobSite.name, m);
  }
  const bySite = [...bySiteMap.entries()]
    .map(([name, m]) => ({ name, compliant: m.compliant, total: m.total, pct: pct(m.compliant, m.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    compliant,
    incomplete: total - compliant,
    ppe: subs.filter((s) => s.ppeConfirmed).length,
    rules: subs.filter((s) => s.rulesAcknowledged).length,
    safe: subs.filter((s) => s.safeWorkingAgreed).length,
    gdpr: subs.filter((s) => s.gdprConsent).length,
    bySite,
  };
}

export interface ComplianceRow {
  id: string;
  checkedInAt: Date;
  status: SubmissionStatus;
  workerName: string;
  workerCompany: string;
  siteName: string;
  ppe: boolean;
  rules: boolean;
  safe: boolean;
  gdpr: boolean;
}

/** Worker-level compliance rows (newest first). `limit` caps on-screen tables. */
export async function getComplianceRows(
  siteIds: string[],
  range: Range,
  limit?: number,
): Promise<ComplianceRow[]> {
  if (!siteIds.length) return [];
  const subs = await prisma.submission.findMany({
    where: where(siteIds, range),
    orderBy: { checkedInAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      checkedInAt: true,
      status: true,
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      worker: { select: { fullName: true, company: true } },
      jobSite: { select: { name: true } },
    },
  });
  return subs.map((s) => ({
    id: s.id,
    checkedInAt: s.checkedInAt,
    status: s.status,
    workerName: s.worker.fullName,
    workerCompany: s.worker.company,
    siteName: s.jobSite.name,
    ppe: s.ppeConfirmed,
    rules: s.rulesAcknowledged,
    safe: s.safeWorkingAgreed,
    gdpr: s.gdprConsent,
  }));
}
