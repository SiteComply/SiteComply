import { CscsCardType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { CSCS_CARD_LABELS } from '@/lib/cscs';

/**
 * CSCS / Competency report data. Covers the distinct workers who have checked in
 * to the accessible sites within the date range, with their CSCS card details.
 * `getCscsSummary` is aggregate (safe for Client); `getCscsRows` is worker-level
 * (non-Client views + the restricted CSV export).
 */

type Range = { gte?: Date; lt?: Date };

export type CscsStatus = 'valid' | 'expired' | 'none';

function statusOf(
  cardType: CscsCardType | null,
  expiry: Date | null,
  nowMs: number,
): CscsStatus {
  if (!cardType) return 'none';
  if (expiry && expiry.getTime() < nowMs) return 'expired';
  return 'valid';
}

function accessibleWorkers(siteIds: string[], range: Range) {
  return prisma.worker.findMany({
    where: {
      submissions: {
        some: {
          jobSiteId: { in: siteIds },
          ...(range.gte || range.lt ? { checkedInAt: range } : {}),
        },
      },
    },
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      company: true,
      cscsCardType: true,
      cscsCardNumber: true,
      cscsExpiry: true,
    },
  });
}

export interface CscsSummary {
  totalWorkers: number;
  valid: number;
  expired: number;
  none: number;
  byType: { label: string; count: number }[];
}

export async function getCscsSummary(
  siteIds: string[],
  range: Range,
): Promise<CscsSummary> {
  const empty: CscsSummary = { totalWorkers: 0, valid: 0, expired: 0, none: 0, byType: [] };
  if (!siteIds.length) return empty;

  const now = Date.now();
  const workers = await accessibleWorkers(siteIds, range);
  let valid = 0;
  let expired = 0;
  let none = 0;
  const typeMap = new Map<string, number>();
  for (const w of workers) {
    const st = statusOf(w.cscsCardType, w.cscsExpiry, now);
    if (st === 'valid') valid += 1;
    else if (st === 'expired') expired += 1;
    else none += 1;
    const label = w.cscsCardType ? CSCS_CARD_LABELS[w.cscsCardType] : 'No card recorded';
    typeMap.set(label, (typeMap.get(label) ?? 0) + 1);
  }
  const byType = [...typeMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return { totalWorkers: workers.length, valid, expired, none, byType };
}

export interface CscsRow {
  id: string;
  workerName: string;
  workerCompany: string;
  cardTypeLabel: string;
  cardNumber: string;
  expiry: Date | null;
  status: CscsStatus;
}

export async function getCscsRows(
  siteIds: string[],
  range: Range,
  limit?: number,
): Promise<CscsRow[]> {
  if (!siteIds.length) return [];
  const now = Date.now();
  let workers = await accessibleWorkers(siteIds, range);
  if (limit) workers = workers.slice(0, limit);
  return workers.map((w) => ({
    id: w.id,
    workerName: w.fullName,
    workerCompany: w.company,
    cardTypeLabel: w.cscsCardType ? CSCS_CARD_LABELS[w.cscsCardType] : 'None',
    cardNumber: w.cscsCardNumber ?? '',
    expiry: w.cscsExpiry,
    status: statusOf(w.cscsCardType, w.cscsExpiry, now),
  }));
}
