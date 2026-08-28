import { CscsCardType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';

/**
 * Worker drill-down aggregate for the Platform → Worker Details page.
 *
 * Site-scoping is enforced by DATA: a worker is only visible if they have at
 * least one submission on one of the viewer's Assigned Sites, and EVERY piece of
 * activity shown (check-in history, compliance status, current site) is restricted
 * to `viewer.siteIds`. A worker's presence on sites the viewer cannot see is never
 * revealed. Returns null when the worker has no in-scope activity → 404.
 */

const utcDayStart = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export interface WorkerHistoryEntry {
  id: string;
  siteId: string;
  siteName: string;
  status: string;
  ppeConfirmed: boolean;
  rulesAcknowledged: boolean;
  safeWorkingAgreed: boolean;
  gdprConsent: boolean;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  // BL-001 — worker history must show a manual close as a manual close.
  checkedOutManual: boolean;
  checkedOutByName: string | null;
  checkedOutByRole: string | null;
  checkedOutReason: string | null;
}

export interface WorkerDetail {
  worker: {
    id: string;
    fullName: string;
    company: string;
    mobile: string;
    cscsCardNumber: string | null;
    cscsCardType: CscsCardType | null;
    cscsExpiry: Date | null;
    // CSCS Smart Check verification (SC-001).
    cscsScheme: string | null;
    cscsVerified: boolean;
    cscsVerificationStatus: string | null;
    cscsVerifiedAt: Date | null;
    cscsHolderName: string | null;
    cscsQualifications: { title: string; detail?: string }[];
    createdAt: Date;
  };
  complianceStatus: {
    latestStatus: string;
    ppe: boolean;
    rules: boolean;
    safe: boolean;
    gdpr: boolean;
    /** CSCS card valid today? null when no expiry is recorded. */
    cscsValid: boolean | null;
  };
  currentSite: { siteId: string; siteName: string; checkedInAt: Date } | null;
  totalCheckIns: number;
  history: WorkerHistoryEntry[];
}

export async function getWorkerDetailForViewer(
  viewer: PlatformViewer,
  workerId: string,
  now: Date = new Date(),
): Promise<WorkerDetail | null> {
  if (viewer.siteIds.length === 0) return null;

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      fullName: true,
      company: true,
      mobile: true,
      cscsCardNumber: true,
      cscsCardType: true,
      cscsExpiry: true,
      cscsScheme: true,
      cscsVerified: true,
      cscsVerificationStatus: true,
      cscsVerifiedAt: true,
      cscsHolderName: true,
      cscsQualifications: true,
      createdAt: true,
    },
  });
  if (!worker) return null;

  // Normalise the stored competency JSON into a typed list for the view.
  const qualifications = Array.isArray(worker.cscsQualifications)
    ? (worker.cscsQualifications as unknown[]).flatMap((q) =>
        q && typeof q === 'object' && 'title' in q
          ? [
              {
                title: String((q as { title: unknown }).title),
                detail:
                  'detail' in q && (q as { detail?: unknown }).detail != null
                    ? String((q as { detail?: unknown }).detail)
                    : undefined,
              },
            ]
          : [],
      )
    : [];

  // ALL data limited to the viewer's sites — the worker's activity elsewhere is invisible.
  const subs = await prisma.submission.findMany({
    where: { workerId, jobSiteId: { in: viewer.siteIds } },
    orderBy: { checkedInAt: 'desc' },
    select: {
      id: true,
      status: true,
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      checkedInAt: true,
      checkedOutAt: true,
      checkedOutManual: true,
      checkedOutByName: true,
      checkedOutByRole: true,
      checkedOutReason: true,
      jobSite: { select: { id: true, name: true } },
    },
  });
  if (subs.length === 0) return null; // no in-scope activity → viewer may not see this worker

  const history: WorkerHistoryEntry[] = subs.map((s) => ({
    id: s.id,
    siteId: s.jobSite.id,
    siteName: s.jobSite.name,
    status: s.status,
    ppeConfirmed: s.ppeConfirmed,
    rulesAcknowledged: s.rulesAcknowledged,
    safeWorkingAgreed: s.safeWorkingAgreed,
    gdprConsent: s.gdprConsent,
    checkedInAt: s.checkedInAt,
    checkedOutAt: s.checkedOutAt,
    checkedOutManual: s.checkedOutManual,
    checkedOutByName: s.checkedOutByName,
    checkedOutByRole: s.checkedOutByRole,
    checkedOutReason: s.checkedOutReason,
  }));

  const latest = subs[0];
  const onSite = subs.find((s) => s.checkedOutAt === null) ?? null;
  const cscsValid = worker.cscsExpiry
    ? worker.cscsExpiry.getTime() >= utcDayStart(now)
    : null;

  return {
    worker: { ...worker, cscsQualifications: qualifications },
    complianceStatus: {
      latestStatus: latest.status,
      ppe: latest.ppeConfirmed,
      rules: latest.rulesAcknowledged,
      safe: latest.safeWorkingAgreed,
      gdpr: latest.gdprConsent,
      cscsValid,
    },
    currentSite: onSite
      ? { siteId: onSite.jobSite.id, siteName: onSite.jobSite.name, checkedInAt: onSite.checkedInAt }
      : null,
    totalCheckIns: subs.length,
    history,
  };
}
