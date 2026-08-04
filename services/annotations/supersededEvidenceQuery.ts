import { prisma } from '@/lib/prisma';

/**
 * SC-017 FOLLOW-UP — the site-wide version of the superseded-original rule.
 *
 * `supersededEvidence.ts` decides the rule for a set of rows already in hand,
 * which is what the evidence gallery needs. The close-out pack cannot use it:
 * the pack takes only the most recent PHOTO_LIMIT photos, so filtering after the
 * query would let superseded originals consume slots and then vanish, quietly
 * shrinking the pack. The exclusion has to be part of the query.
 *
 * Server-only — it touches Prisma, which is why it is separate from the pure
 * module the client component shares.
 */

/**
 * Ids of evidence rows on this site that an annotated copy was made from.
 *
 * Existence of the original is NOT checked: these ids are only ever used to
 * EXCLUDE, so a dangling id (original since deleted) matches nothing and costs
 * nothing. That keeps this to two cheap indexed reads.
 */
export async function supersededEvidenceIdsForSite(siteId: string): Promise<{
  findingEvidenceIds: string[];
  actionEvidenceIds: string[];
}> {
  const [findings, actions] = await Promise.all([
    prisma.findingEvidence.findMany({
      where: {
        finding: { audit: { jobSiteId: siteId } },
        annotated: true,
        originalEvidenceId: { not: null },
      },
      select: { originalEvidenceId: true },
    }),
    prisma.actionEvidence.findMany({
      where: {
        action: { jobSiteId: siteId },
        annotated: true,
        originalEvidenceId: { not: null },
      },
      select: { originalEvidenceId: true },
    }),
  ]);

  return {
    findingEvidenceIds: findings
      .map((r) => r.originalEvidenceId)
      .filter((id): id is string => Boolean(id)),
    actionEvidenceIds: actions
      .map((r) => r.originalEvidenceId)
      .filter((id): id is string => Boolean(id)),
  };
}

/**
 * A Prisma `id` filter that excludes the given ids, or undefined when there are
 * none. Written as a helper so the three places that need it cannot disagree
 * about how an empty list is handled.
 */
export function excludeIds(ids: string[]): { notIn: string[] } | undefined {
  return ids.length > 0 ? { notIn: ids } : undefined;
}
