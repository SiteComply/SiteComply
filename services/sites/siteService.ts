import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isRetiredInductionItem } from '@/services/checklists/inductionFlow';

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
  // Drop questions retired by REV-1 decisions from the LIVE induction only —
  // SC-012's duplicate CSCS question (its status comes from the verified SC-001
  // record, shown pre-induction) and SC-018's toolbox-talk question (delivered
  // separately by supervisors). Stored checklist rows are untouched, so historic
  // submissions and their receipts are unaffected. This is the single filter
  // point, so the wizard render and server-side check-in validation can never
  // disagree about which questions apply.
  const filtered = checklist
    ? {
        ...checklist,
        items: checklist.items.filter((i) => !isRetiredInductionItem(i)),
      }
    : null;
  return { ...site, checklist: filtered };
}
