import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';

/**
 * Unified organisation activity stream for the Platform dashboard.
 *
 * Aggregates significant events from every module — worker check-ins, audits
 * (created / signed off), findings, actions (opened / completed / overdue),
 * evidence uploads and document uploads / expiries — into one chronological feed.
 *
 * RBAC + site-scoping are enforced per source: an event is only queried if the
 * viewer may view that module (`permits`), and every query is constrained to the
 * viewer's Assigned Sites (directly by `jobSiteId`, or through the owning
 * audit/action for findings and evidence). So a user only ever sees activity for
 * records they could open themselves. Each source contributes its most recent few
 * events; the merged list is sorted newest-first and capped.
 */

export type ActivityKind =
  | 'checkin'
  | 'audit_created'
  | 'audit_signed_off'
  | 'finding_created'
  | 'action_created'
  | 'action_completed'
  | 'action_overdue'
  | 'document_uploaded'
  | 'document_expired'
  | 'evidence_uploaded';

export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  /** Primary subject (worker name, audit/action/document title, or file name). */
  title: string;
  /** Short description of what happened, e.g. "checked in at Riverside". */
  detail: string;
  /** Link to the relevant record (already in the viewer's scope). */
  href: string;
  /** ISO timestamp of the event. */
  at: string;
}

// How many rows each source contributes before the merge; kept small so the
// dashboard stays fast — the final list is capped by `limit` anyway.
const SOURCE_TAKE = 8;

export async function getRecentActivity(
  viewer: PlatformViewer,
  limit = 12,
  now: Date = new Date(),
): Promise<ActivityItem[]> {
  const siteIds = viewer.siteIds;
  if (siteIds.length === 0) return [];
  const site = { jobSiteId: { in: siteIds } };

  const canCheckins = permits(viewer.role, 'checkins', 'view');
  const canAudits = permits(viewer.role, 'audits', 'view');
  const canActions = permits(viewer.role, 'actions', 'view');
  const canDocs = permits(viewer.role, 'documents', 'view');

  const tasks: Promise<ActivityItem[]>[] = [];

  if (canCheckins) {
    tasks.push(
      prisma.submission
        .findMany({
          where: site,
          orderBy: { checkedInAt: 'desc' },
          take: SOURCE_TAKE,
          select: {
            id: true,
            checkedInAt: true,
            worker: { select: { id: true, fullName: true } },
            jobSite: { select: { name: true } },
          },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `checkin:${r.id}`,
            kind: 'checkin' as const,
            title: r.worker.fullName,
            detail: `checked in at ${r.jobSite.name}`,
            href: `/platform/dashboard/workers/${r.worker.id}`,
            at: r.checkedInAt.toISOString(),
          })),
        ),
    );
  }

  if (canAudits) {
    tasks.push(
      prisma.audit
        .findMany({
          where: site,
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, createdByName: true, createdAt: true, jobSite: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `audit_created:${r.id}`,
            kind: 'audit_created' as const,
            title: r.title,
            detail: `audit created at ${r.jobSite.name}${r.createdByName ? ` by ${r.createdByName}` : ''}`,
            href: `/platform/dashboard/audits/${r.id}`,
            at: r.createdAt.toISOString(),
          })),
        ),
      prisma.audit
        .findMany({
          where: { ...site, status: 'SIGNED_OFF', signedOffAt: { not: null } },
          orderBy: { signedOffAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, signedOffByName: true, signedOffAt: true },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `audit_signed_off:${r.id}:${r.signedOffAt!.getTime()}`,
            kind: 'audit_signed_off' as const,
            title: r.title,
            detail: `signed off${r.signedOffByName ? ` by ${r.signedOffByName}` : ''}`,
            href: `/platform/dashboard/audits/${r.id}`,
            at: r.signedOffAt!.toISOString(),
          })),
        ),
      prisma.auditFinding
        .findMany({
          where: { audit: site },
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, auditId: true, createdAt: true, audit: { select: { title: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `finding_created:${r.id}`,
            kind: 'finding_created' as const,
            title: r.title,
            detail: `finding raised on ${r.audit.title}`,
            href: `/platform/dashboard/audits/${r.auditId}`,
            at: r.createdAt.toISOString(),
          })),
        ),
      prisma.findingEvidence
        .findMany({
          where: { finding: { audit: site } },
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, fileName: true, createdAt: true, finding: { select: { title: true, auditId: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `finding_evidence:${r.id}`,
            kind: 'evidence_uploaded' as const,
            title: r.fileName,
            detail: `evidence added to finding “${r.finding.title}”`,
            href: `/platform/dashboard/audits/${r.finding.auditId}`,
            at: r.createdAt.toISOString(),
          })),
        ),
    );
  }

  if (canActions) {
    tasks.push(
      prisma.action
        .findMany({
          where: site,
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, createdAt: true, jobSite: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `action_created:${r.id}`,
            kind: 'action_created' as const,
            title: r.title,
            detail: `action opened at ${r.jobSite.name}`,
            href: `/platform/dashboard/actions/${r.id}`,
            at: r.createdAt.toISOString(),
          })),
        ),
      prisma.action
        .findMany({
          where: { ...site, status: 'COMPLETED', completedAt: { not: null } },
          orderBy: { completedAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, completedAt: true },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `action_completed:${r.id}:${r.completedAt!.getTime()}`,
            kind: 'action_completed' as const,
            title: r.title,
            detail: `action completed`,
            href: `/platform/dashboard/actions/${r.id}`,
            at: r.completedAt!.toISOString(),
          })),
        ),
      prisma.action
        .findMany({
          where: { ...site, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { not: null, lt: now } },
          orderBy: { dueDate: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, dueDate: true },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `action_overdue:${r.id}`,
            kind: 'action_overdue' as const,
            title: r.title,
            detail: `action became overdue`,
            href: `/platform/dashboard/actions/${r.id}`,
            at: r.dueDate!.toISOString(),
          })),
        ),
      prisma.actionEvidence
        .findMany({
          where: { action: site },
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, fileName: true, actionId: true, createdAt: true, action: { select: { title: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `action_evidence:${r.id}`,
            kind: 'evidence_uploaded' as const,
            title: r.fileName,
            detail: `evidence added to action “${r.action.title}”`,
            href: `/platform/dashboard/actions/${r.actionId}`,
            at: r.createdAt.toISOString(),
          })),
        ),
    );
  }

  if (canDocs) {
    // One document, not two. An annotated upload is stored as the untouched
    // original plus the annotated copy, so an unfiltered feed shows the same
    // upload twice — and since the two rows now carry the same title, it reads
    // as the identical line repeated. Worse, the feed takes only SOURCE_TAKE
    // rows: a pair burns two of those slots and pushes a genuine item off the
    // list, so filtering afterwards would not do — the exclusion has to be in
    // the query. Same rule and same helper as the Documents register.
    const supersededDocs = await supersededDocumentIds(siteIds);
    const notSuperseded =
      supersededDocs.length > 0 ? { id: { notIn: supersededDocs } } : {};
    tasks.push(
      prisma.document
        .findMany({
          where: { ...site, ...notSuperseded },
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, createdAt: true, jobSite: { select: { name: true } } },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `document_uploaded:${r.id}`,
            kind: 'document_uploaded' as const,
            title: r.title,
            detail: `document uploaded to ${r.jobSite.name}`,
            href: `/platform/dashboard/documents/${r.id}`,
            at: r.createdAt.toISOString(),
          })),
        ),
      prisma.document
        .findMany({
          where: { ...site, ...notSuperseded, expiresAt: { not: null, lt: now } },
          orderBy: { expiresAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, title: true, expiresAt: true },
        })
        .then((rows) =>
          rows.map((r) => ({
            key: `document_expired:${r.id}`,
            kind: 'document_expired' as const,
            title: r.title,
            detail: `document expired`,
            href: `/platform/dashboard/documents/${r.id}`,
            at: r.expiresAt!.toISOString(),
          })),
        ),
    );
  }

  const all = (await Promise.all(tasks)).flat();
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, limit);
}
