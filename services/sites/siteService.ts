import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isCscsCompetencyItem } from '@/services/checklists/inductionFlow';

/**
 * Job-site queries used by the worker flow.
 *
 * Workers only ever see ACTIVE sites. The admin CRUD that creates/archives sites
 * arrives in Stage 8; this service is the read side the worker journey depends on.
 */

/** Active sites for the worker site-selection list (lightweight fields). */
export function listActiveSitesForSelection() {
  return prisma.jobSite.findMany({
    where: { status: SiteStatus.ACTIVE },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      jobReference: true,
      town: true,
      postcode: true,
    },
  });
}

/** A single active site with its current (latest-version) checklist. */
export async function getActiveSiteWithChecklist(id: string) {
  const site = await prisma.jobSite.findFirst({
    where: { id, status: SiteStatus.ACTIVE },
    include: {
      checklists: {
        orderBy: { version: 'desc' },
        take: 1,
        include: { items: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!site) return null;
  const checklist = site.checklists[0] ?? null;
  // SC-012: drop the duplicate CSCS competency question from the live induction
  // (its status comes from the verified SC-001 record, shown pre-induction).
  const filtered = checklist
    ? {
        ...checklist,
        items: checklist.items.filter((i) => !isCscsCompetencyItem(i)),
      }
    : null;
  return { ...site, checklist: filtered };
}
