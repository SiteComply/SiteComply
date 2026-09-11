import { prisma } from '@/lib/prisma';
import type { ErrorEventPortal } from '@prisma/client';

/** Reading the error log. Separated from the writer: the write path runs inside
 *  failing requests and must stay as small as possible. */

export interface ErrorListFilters {
  portal?: ErrorEventPortal | null;
  /** Matches a reference, a digest, or part of the message or page path. */
  q?: string | null;
  days?: number;
}

export async function listErrorEvents(filters: ErrorListFilters, limit = 100) {
  const since = new Date(
    Date.now() - (filters.days ?? 30) * 24 * 60 * 60 * 1000,
  );
  const q = (filters.q ?? '').trim();
  return prisma.errorEvent.findMany({
    where: {
      lastSeenAt: { gte: since },
      ...(filters.portal ? { portal: filters.portal } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' as const } },
              { digest: { contains: q, mode: 'insensitive' as const } },
              { message: { contains: q, mode: 'insensitive' as const } },
              { pagePath: { contains: q, mode: 'insensitive' as const } },
              { route: { contains: q, mode: 'insensitive' as const } },
              { userName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
  });
}

export async function getErrorEvent(id: string) {
  return prisma.errorEvent.findUnique({ where: { id } });
}

/** Headline counts, so the page opens on "is anything wrong right now". */
export async function errorSummary() {
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [last24h, last7d, distinct7d] = await Promise.all([
    prisma.errorEvent.count({ where: { lastSeenAt: { gte: day } } }),
    prisma.errorEvent.count({ where: { lastSeenAt: { gte: week } } }),
    prisma.errorEvent.groupBy({
      by: ['fingerprint'],
      where: { lastSeenAt: { gte: week } },
    }),
  ]);
  return { last24h, last7d, distinctFaults7d: distinct7d.length };
}
