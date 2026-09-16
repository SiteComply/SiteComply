import { CscsCardType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isCscsExemptMobile } from '@/services/cscs/cscsExemptAccounts';
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
    /** Family name, captured separately. Never derived from fullName. */
    surname: string | null;
    /**
     * Whether this operative is on the CSCS exempt allow-list.
     *
     * Surfaced so an admin is never left wondering why one account stays
     * unverified while every other card checks. A bypass nobody can see is a
     * bypass someone eventually mistakes for a fault.
     */
    cscsExempt: boolean;
    company: string;
    mobile: string;
    cscsCardNumber: string | null;
    cscsCardType: CscsCardType | null;
    /** Smart Check scheme id chosen at capture — an INPUT to the lookup,
          distinct from cscsScheme below, which is what the check returned. */
    cscsSchemeId: string | null;
    cscsExpiry: Date | null;
    // CSCS Smart Check verification (SC-001).
    cscsScheme: string | null;
    cscsVerified: boolean;
    cscsVerificationStatus: string | null;
    cscsVerifiedAt: Date | null;
    cscsHolderName: string | null;
    cscsQualifications: { title: string; detail?: string }[];
    /**
     * Which provider produced the CSCS fields above, or null if no check has
     * run. 'mock' means a TEST provider produced them — not a CSCS
     * verification, whatever cscsVerificationStatus says.
     */
    verifiedByProvider: string | null;
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
      surname: true,
      company: true,
      mobile: true,
      cscsCardNumber: true,
      cscsCardType: true,
      cscsSchemeId: true,
      cscsExpiry: true,
      cscsScheme: true,
      cscsVerified: true,
      cscsVerificationStatus: true,
      cscsVerifiedAt: true,
      cscsHolderName: true,
      cscsQualifications: true,
      createdAt: true,
      // CSCS cutover Phase 1 — WHICH provider produced the stored result. The
      // Worker row does not record it, so the screen said "Smart Check" over a
      // result the mock invented. Only the log knows, so ask the log.
      cscsVerifications: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { provider: true },
      },
    },
  });
  if (!worker) return null;

  /**
   * The provider behind the CSCS fields on this record, or null when no check
   * has ever run. 'mock' means a TEST provider produced it and it is not a
   * CSCS verification, whatever the status says.
   */
  const verifiedByProvider = worker.cscsVerifications[0]?.provider ?? null;

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
    worker: {
      ...worker,
      cscsQualifications: qualifications,
      verifiedByProvider,
      // Read from the environment, not stored: the allow-list changes by
      // configuration without a deploy, so a persisted copy would go stale.
      cscsExempt: isCscsExemptMobile(worker.mobile),
    },
    complianceStatus: {
      latestStatus: latest.status,
      ppe: latest.ppeConfirmed,
      rules: latest.rulesAcknowledged,
      safe: latest.safeWorkingAgreed,
      gdpr: latest.gdprConsent,
      cscsValid,
    },
    currentSite: onSite
      ? {
          siteId: onSite.jobSite.id,
          siteName: onSite.jobSite.name,
          checkedInAt: onSite.checkedInAt,
        }
      : null,
    totalCheckIns: subs.length,
    history,
  };
}
