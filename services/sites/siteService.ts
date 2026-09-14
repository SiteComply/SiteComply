import { SiteStatus, WorkerAssignmentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isRetiredInductionItem } from '@/services/checklists/inductionFlow';

/**
 * Job-site queries used by the worker flow.
 *
 * Workers only ever see ACTIVE sites. The admin CRUD that creates/archives sites
 * arrives in Stage 8; this service is the read side the worker journey depends on.
 */

/**
 * Owner Review Item 17 — the sites an operative may choose from.
 *
 * Scoped to the projects this operative actually has a relationship with. It
 * used to return EVERY active site, annotated with a "Not invited" badge, on the
 * reasoning that hiding a site would leave someone who should have been invited
 * staring at a list that silently omits it.
 *
 * That reasoning only covers the person who SHOULD be on the project. It ignores
 * everyone else: every signed-in operative could read the name, job reference,
 * town and postcode of every live project on the platform, including other
 * customers'. On a multi-tenant product that is commercially sensitive
 * information, and no operative needs it to check in.
 *
 * Filtered in the QUERY rather than in the page, so a site an operative has no
 * relationship with is never loaded, never serialised, and never reaches the
 * browser — not merely hidden once it is there.
 *
 * REMOVED is excluded: that access was deliberately ended. Every other state is
 * kept, including suspended and out-of-window, because the operative IS on the
 * project and the badge tells them what to ask their site manager for. That is
 * the case the original comment was right about, and it is preserved.
 */
export function listSitesForWorkerSelection(workerId: string) {
  return prisma.jobSite.findMany({
    where: {
      status: SiteStatus.ACTIVE,
      workerAssignments: {
        some: {
          workerId,
          status: { not: WorkerAssignmentStatus.REMOVED },
        },
      },
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      jobReference: true,
      town: true,
      postcode: true,
      // Needed to work out, without a per-site round trip, whether this site
      // enforces worker access at all — see siteAccessHintsForWorker.
      workerAccessEnforced: true,
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
