import { redirect } from 'next/navigation';
import { DocumentCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { listSiteContacts } from '@/services/sites/siteContactService';
import { listActiveBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  getPanelVisibility,
  type PanelVisibility,
} from '@/services/workerDashboard/dashboardConfigService';

/**
 * Worker Dashboard data access (SC-003).
 *
 * Everything here is keyed by the worker's OPEN check-in — the submission with no
 * `checkedOutAt`. That single fact is the access boundary for the whole worker
 * dashboard: a worker sees a site's bulletins, documents, contacts, emergency
 * information and actions only while they are actually checked into that site.
 * Nothing is scoped by a platform role, and there is no way to name a different
 * site: the site is derived from the check-in, never taken from the request.
 */

export interface WorkerContext {
  worker: { id: string; fullName: string; company: string };
  submission: {
    id: string;
    checkedInAt: Date;
    jobSiteId: string;
  };
  site: {
    id: string;
    name: string;
    jobReference: string;
    addressLine1: string;
    addressLine2: string | null;
    town: string;
    postcode: string;
    fireAssemblyPoint: string | null;
    firstAiderName: string | null;
    firstAiderNumber: string | null;
    firstAiderLocation: string | null;
    nearestHospital: string | null;
    emergencyNumber: string | null;
  };
  /** Which panels this site displays (defaults overlaid with site overrides). */
  panels: PanelVisibility;
}

const SITE_SELECT = {
  id: true,
  name: true,
  jobReference: true,
  addressLine1: true,
  addressLine2: true,
  town: true,
  postcode: true,
  fireAssemblyPoint: true,
  firstAiderName: true,
  firstAiderNumber: true,
  firstAiderLocation: true,
  nearestHospital: true,
  emergencyNumber: true,
} as const;

/**
 * The worker's current on-site context, or null when they have no open check-in.
 * The most recent open check-in wins if a worker somehow has more than one.
 */
export async function getWorkerContext(): Promise<WorkerContext | null> {
  const session = getWorkerSession();
  if (!session) return null;

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) return null;

  const submission = await prisma.submission.findFirst({
    where: { workerId: worker.id, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      checkedInAt: true,
      jobSiteId: true,
      jobSite: { select: SITE_SELECT },
    },
  });
  if (!submission) return null;

  return {
    worker: {
      id: worker.id,
      fullName: worker.fullName,
      company: worker.company,
    },
    submission: {
      id: submission.id,
      checkedInAt: submission.checkedInAt,
      jobSiteId: submission.jobSiteId,
    },
    site: submission.jobSite,
    panels: await getPanelVisibility(submission.jobSiteId),
  };
}

/**
 * Require an on-site worker for a Worker Dashboard page.
 *
 * No session → the check-in journey. Session but no open check-in (they've
 * checked out, or the session outlived the visit) → the site selector, so the
 * worker can check in again rather than land on a dead end.
 */
export async function requireWorkerContext(): Promise<WorkerContext> {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const context = await getWorkerContext();
  if (!context) redirect('/check-in/site');
  return context;
}

// ---------------------------------------------------------------------------
// Panel data
// ---------------------------------------------------------------------------

export interface WorkerDashboardCounts {
  /** Active bulletins for the site the worker hasn't acknowledged. */
  unreadBulletins: number;
  /** All active bulletins for the site. */
  totalBulletins: number;
  ramsDocuments: number;
  /** Site documents excluding RAMS, which has its own panel. */
  otherDocuments: number;
  outstandingActions: number;
  siteContacts: number;
}

/**
 * Counts backing the dashboard's summary cards. Queried in one round trip and
 * always for the checked-into site only.
 */
export async function getWorkerDashboardCounts(
  siteId: string,
  workerId: string,
): Promise<WorkerDashboardCounts> {
  const [
    unreadBulletins,
    totalBulletins,
    ramsDocuments,
    otherDocuments,
    outstandingActions,
    siteContacts,
  ] = await Promise.all([
    prisma.siteBulletin.count({
      where: { jobSiteId: siteId, active: true, reads: { none: { workerId } } },
    }),
    prisma.siteBulletin.count({ where: { jobSiteId: siteId, active: true } }),
    prisma.document.count({
      where: { jobSiteId: siteId, category: DocumentCategory.RAMS },
    }),
    prisma.document.count({
      where: { jobSiteId: siteId, category: { not: DocumentCategory.RAMS } },
    }),
    prisma.action.count({
      where: { jobSiteId: siteId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    prisma.siteContact.count({ where: { jobSiteId: siteId } }),
  ]);

  return {
    unreadBulletins,
    totalBulletins,
    ramsDocuments,
    otherDocuments,
    outstandingActions,
    siteContacts,
  };
}

/** Active bulletins for the worker's site, newest first, with read state. */
export function getWorkerBulletins(siteId: string, workerId: string) {
  return listActiveBulletinsForWorker(siteId, workerId);
}

/** The site's contacts in display order (used by the panel and detail page). */
export function getWorkerSiteContacts(siteId: string) {
  return listSiteContacts(siteId);
}

export interface WorkerDocument {
  id: string;
  title: string;
  description: string | null;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Documents for the worker's site. `category` narrows to one bucket (RAMS for
 * the RAMS panel); `excludeRams` powers the Site documents panel, which shows
 * everything else so a document is never counted twice.
 */
export function getWorkerDocuments(
  siteId: string,
  opts: { category?: DocumentCategory; excludeRams?: boolean } = {},
): Promise<WorkerDocument[]> {
  return prisma.document.findMany({
    where: {
      jobSiteId: siteId,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.excludeRams ? { category: { not: DocumentCategory.RAMS } } : {}),
    },
    orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

/**
 * A document the worker is entitled to download: it must belong to the site of
 * their own open check-in. Returns null otherwise — this is the only check
 * standing between a worker session and a private site file, so it deliberately
 * re-derives the check-in rather than trusting anything from the request.
 */
export async function getDocumentForCheckedInWorker(
  workerId: string,
  documentId: string,
): Promise<{ blobPath: string; fileName: string; mimeType: string } | null> {
  const openCheckIn = await prisma.submission.findFirst({
    where: { workerId, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: { jobSiteId: true },
  });
  if (!openCheckIn) return null;

  return prisma.document.findFirst({
    where: { id: documentId, jobSiteId: openCheckIn.jobSiteId },
    select: { blobPath: true, fileName: true, mimeType: true },
  });
}

export interface WorkerAction {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: Date | null;
}

/**
 * Outstanding corrective actions for the worker's site.
 *
 * Deliberately narrow: title, priority, status and due date only. Assignees,
 * descriptions, completion notes, evidence and the activity timeline are
 * management data and are never exposed to the worker view.
 */
export function getWorkerOutstandingActions(
  siteId: string,
): Promise<WorkerAction[]> {
  return prisma.action.findMany({
    where: { jobSiteId: siteId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      priority: true,
      status: true,
      dueDate: true,
    },
  });
}
