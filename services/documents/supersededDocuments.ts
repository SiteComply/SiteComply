import { prisma } from '@/lib/prisma';

/**
 * One document, not two — the Documents module's own version of the rule.
 *
 * An annotated upload is stored as TWO rows: the untouched original, and the
 * annotated copy linked back to it by `originalDocumentId`. That is the right
 * storage model and it is unchanged — the original is what proves what was
 * uploaded before anyone drew on it.
 *
 * What was wrong was the PRESENTATION. Both rows were listed, counted and
 * offered for selection, so one document appeared twice everywhere it was shown
 * and double-counted in the expiry KPIs. An original that has been annotated is
 * SUPERSEDED: the annotated copy is the document, and the original is retained
 * for audit but kept out of the register, the pickers and the counts.
 *
 * DERIVED, NOT STORED — deliberately, for the same reasons as the evidence rule:
 * it applies retrospectively with no migration, and it self-heals, because it
 * asks whether a surviving annotated row still points at the original. A stored
 * flag would leave an original hidden forever once its annotated copy was gone.
 *
 * SCOPE. This is for the Documents module and the Worker Portal document views
 * ONLY. Audit findings, action evidence and the audit photo galleries have their
 * own rule in `services/annotations/supersededEvidence.ts` and intentionally DO
 * distinguish original from annotated — an audit record has to be able to show
 * the unmarked photo. The two rules look alike and must not be merged: they
 * answer to different requirements and are free to diverge.
 *
 * Nothing here deletes, alters or hides anything at rest. Every original keeps
 * its row, its blob, its uploader, its timestamp, its `annotationData` and its
 * audit references.
 */

/**
 * Ids of documents that a surviving annotated copy was made from.
 *
 * Existence of the original is NOT checked: these ids are only ever used to
 * EXCLUDE, so a dangling id (original since deleted) matches nothing and costs
 * nothing — `originalDocumentId` has no foreign key, so dangling links are a
 * real possibility, not a theoretical one.
 *
 * Scoped to the sites in play so the query stays cheap and never reaches across
 * a viewer's access boundary.
 */
export async function supersededDocumentIds(
  siteIds: string[],
): Promise<string[]> {
  if (siteIds.length === 0) return [];
  const rows = await prisma.document.findMany({
    where: {
      jobSiteId: { in: siteIds },
      annotated: true,
      originalDocumentId: { not: null },
    },
    select: { originalDocumentId: true },
  });
  return rows
    .map((r) => r.originalDocumentId)
    .filter((id): id is string => Boolean(id));
}
