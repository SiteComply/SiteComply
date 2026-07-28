import { redirect } from 'next/navigation';
import { DocumentCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getWorkerSession, getActiveWorkerSiteId } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { listSiteContacts } from '@/services/sites/siteContactService';
import { listActiveBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  getPanelVisibility,
  type PanelVisibility,
} from '@/services/workerDashboard/dashboardConfigService';

/**
 * Worker Dashboard data access (SC-003 / SC-004).
 *
 * Everything here is keyed by the worker's OPEN check-ins — submissions with no
 * `checkedOutAt`. That set is the access boundary for the whole worker area: a
 * worker sees a site's bulletins, documents, contacts, emergency information and
 * actions only while they are actually checked into that site. Nothing is scoped
 * by a platform role.
 *
 * A worker may be checked into more than one site at once (SC-004). The "active"
 * site is chosen from an `sc_worker_site` cookie, but that cookie is only a hint:
 * it is ALWAYS re-validated against the worker's own open check-ins here, so it
 * can never surface a site they aren't checked into — an unknown/stale value
 * just falls back to their most recent check-in.
 */

export interface WorkerCheckIn {
  submissionId: string;
  siteId: string;
  siteName: string;
  jobReference: string;
  checkedInAt: Date;
}

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
  /** Which panels the active site displays (defaults overlaid with overrides). */
  panels: PanelVisibility;
  /** Every site the worker is currently checked into (most recent first). */
  openCheckIns: WorkerCheckIn[];
  /** The active site's id (one of `openCheckIns`). */
  activeSiteId: string;
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

/** The signed-in worker record (identity only), or null. No check-in required. */
export async function getWorkerIdentity(): Promise<{
  id: string;
  fullName: string;
  company: string;
} | null> {
  const session = getWorkerSession();
  if (!session) return null;
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) return null;
  return { id: worker.id, fullName: worker.fullName, company: worker.company };
}

/** Require a signed-in worker (identity only); redirect to check-in otherwise. */
export async function requireWorkerIdentity(): Promise<{
  id: string;
  fullName: string;
  company: string;
}> {
  if (!getWorkerSession()) redirect('/check-in');
  const worker = await getWorkerIdentity();
  if (!worker) redirect('/check-in/details');
  return worker;
}

/** Every site the given worker is currently checked into, most recent first. */
export async function listOpenCheckIns(
  workerId: string,
): Promise<WorkerCheckIn[]> {
  const rows = await prisma.submission.findMany({
    where: { workerId, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      checkedInAt: true,
      jobSiteId: true,
      jobSite: { select: { name: true, jobReference: true } },
    },
  });
  return rows.map((r) => ({
    submissionId: r.id,
    siteId: r.jobSiteId,
    siteName: r.jobSite.name,
    jobReference: r.jobSite.jobReference,
    checkedInAt: r.checkedInAt,
  }));
}

export interface WorkerRecentCheckIn extends WorkerCheckIn {
  checkedOutAt: Date | null;
}

/**
 * A worker's recent check-ins (open and closed), most recent first — for the
 * worker home hub, so a checked-out worker can still reach a site's check-out
 * receipt and see where they've been.
 */
export async function listRecentCheckIns(
  workerId: string,
  take = 5,
): Promise<WorkerRecentCheckIn[]> {
  const rows = await prisma.submission.findMany({
    where: { workerId },
    orderBy: { checkedInAt: 'desc' },
    take,
    select: {
      id: true,
      checkedInAt: true,
      checkedOutAt: true,
      jobSiteId: true,
      jobSite: { select: { name: true, jobReference: true } },
    },
  });
  return rows.map((r) => ({
    submissionId: r.id,
    siteId: r.jobSiteId,
    siteName: r.jobSite.name,
    jobReference: r.jobSite.jobReference,
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
  }));
}

/**
 * The worker's active on-site context, or null when they have no open check-in.
 *
 * The active site is the one named by the `sc_worker_site` cookie IF the worker
 * still holds an open check-in there; otherwise their most recent check-in. The
 * cookie is never trusted on its own — this validation is the access boundary.
 */
export async function getWorkerContext(): Promise<WorkerContext | null> {
  const session = getWorkerSession();
  if (!session) return null;

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) return null;

  const open = await prisma.submission.findMany({
    where: { workerId: worker.id, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      checkedInAt: true,
      jobSiteId: true,
      jobSite: { select: SITE_SELECT },
    },
  });
  if (open.length === 0) return null;

  const preferred = getActiveWorkerSiteId();
  const active =
    (preferred && open.find((s) => s.jobSiteId === preferred)) || open[0];

  return {
    worker: {
      id: worker.id,
      fullName: worker.fullName,
      company: worker.company,
    },
    submission: {
      id: active.id,
      checkedInAt: active.checkedInAt,
      jobSiteId: active.jobSiteId,
    },
    site: active.jobSite,
    panels: await getPanelVisibility(active.jobSiteId),
    openCheckIns: open.map((s) => ({
      submissionId: s.id,
      siteId: s.jobSiteId,
      siteName: s.jobSite.name,
      jobReference: s.jobSite.jobReference,
      checkedInAt: s.checkedInAt,
    })),
    activeSiteId: active.jobSiteId,
  };
}

/**
 * Require an active on-site worker for a Worker Dashboard page.
 *
 * No session → the check-in journey. Session but no open check-in (they've just
 * checked out, or the session outlived the visit) → the worker home hub, which
 * keeps them signed in with continued access (SC-004) rather than a dead end.
 */
export async function requireWorkerContext(): Promise<WorkerContext> {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const context = await getWorkerContext();
  if (!context) redirect('/worker');
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
  /** The worker's active permits (SC-009) for this site. */
  activePermits: number;
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
    activePermits,
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
    prisma.permit.count({
      where: {
        jobSiteId: siteId,
        workerId,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
      },
    }),
  ]);

  return {
    unreadBulletins,
    totalBulletins,
    ramsDocuments,
    otherDocuments,
    outstandingActions,
    siteContacts,
    activePermits,
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
