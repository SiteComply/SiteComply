import { prisma } from '@/lib/prisma';
import type { Prisma, Permit, PermitActivity } from '@prisma/client';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canApprovePermit,
} from '@/services/platformUsers/platformPermissions';
import {
  REJECTION_REASON_MAX,
  permitStatusLabel,
  type PermitStatusValue,
} from '@/services/permits/permitConstants';
import { effectiveStatus } from '@/services/permits/permitService';
import type { AnsweredQuestion } from '@/services/permits/permitFlow';

/**
 * Platform (site-manager) side of Permits (SC-009): scoped list + review /
 * approve / reject / close. Gated by the `permits` module verb AND the site
 * boundary (viewer.siteIds); approval/rejection additionally require the
 * PERMIT_APPROVAL_ROLES allow-list (canApprovePermit), mirroring audit sign-off.
 */

export interface PermitListFilters {
  status?: string;
  siteId?: string;
  search?: string;
  skip?: number;
  take?: number;
}

export interface PermitListRow {
  id: string;
  reference: string;
  permitTypeName: string;
  status: PermitStatusValue;
  statusLabel: string;
  siteName: string;
  workerName: string;
  submittedAt: Date;
  validUntil: Date | null;
}

function scopeWhere(
  viewer: PlatformViewer,
  filters: PermitListFilters,
): Prisma.PermitWhereInput {
  const siteIds =
    filters.siteId && viewer.siteIds.includes(filters.siteId)
      ? [filters.siteId]
      : viewer.siteIds;
  const where: Prisma.PermitWhereInput = { jobSiteId: { in: siteIds } };

  // Collected rather than assigned directly, because two of the clauses below
  // are themselves an OR and the second would overwrite the first.
  const and: Prisma.PermitWhereInput[] = [];

  if (filters.status && filters.status !== 'all') {
    // FILTER ON THE STATUS THE USER CAN SEE.
    //
    // EXPIRED is DERIVED at render time — effectiveStatus() reads an APPROVED
    // permit past its validUntil as Expired — but it is almost never stored,
    // so filtering on the column alone disagreed with the badge in both
    // directions: "Expired" returned nothing while expired permits sat in the
    // register, and "Approved" returned those same permits, every one of them
    // displaying as Expired.
    //
    // The two branches below are the same rule effectiveStatus applies,
    // expressed as a query. Any other status is stored verbatim and needs no
    // translation.
    const now = new Date();
    if (filters.status === 'EXPIRED') {
      and.push({
        OR: [
          // Still matched, because the enum value can be stored directly.
          { status: 'EXPIRED' },
          { status: 'APPROVED', validUntil: { lt: now } },
        ],
      });
    } else if (filters.status === 'APPROVED') {
      // Approved means approved AND still in date. A null validUntil never
      // expires, so it stays approved.
      and.push({
        status: 'APPROVED',
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      });
    } else {
      and.push({ status: filters.status as PermitStatusValue });
    }
  }

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    and.push({
      OR: [
        { reference: { contains: q, mode: 'insensitive' } },
        { permitTypeName: { contains: q, mode: 'insensitive' } },
        { submittedByName: { contains: q, mode: 'insensitive' } },
        { worker: { fullName: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export async function countPermitsForViewer(
  viewer: PlatformViewer,
  filters: PermitListFilters = {},
): Promise<number> {
  if (!viewer.siteIds.length) return 0;
  return prisma.permit.count({ where: scopeWhere(viewer, filters) });
}

export async function listPermitsForViewer(
  viewer: PlatformViewer,
  filters: PermitListFilters = {},
): Promise<PermitListRow[]> {
  if (!viewer.siteIds.length) return [];
  const rows = await prisma.permit.findMany({
    where: scopeWhere(viewer, filters),
    // A UNIQUE TIEBREAKER, NOT TIDINESS. Every key above can tie, so without a
    // unique last key Postgres may return tied rows in any order and may choose
    // differently on each query. With skip/take paging that means a row can
    // appear on two pages while another appears on none — invisible on page one
    // and only under paging. Ties are not rare here: rows created together in
    // one transaction share createdAt exactly.
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: filters.skip ?? 0,
    take: filters.take ?? 25,
    include: {
      jobSite: { select: { name: true } },
      worker: { select: { fullName: true } },
    },
  });
  return rows.map((p) => {
    const status = effectiveStatus(p);
    return {
      id: p.id,
      reference: p.reference,
      permitTypeName: p.permitTypeName,
      status,
      statusLabel: permitStatusLabel(status),
      siteName: p.jobSite.name,
      workerName: p.worker.fullName,
      submittedAt: p.submittedAt,
      validUntil: p.validUntil,
    };
  });
}

/** Count permits awaiting a decision in the viewer's scope (for the badge). */
export async function countPendingPermitsForViewer(
  viewer: PlatformViewer,
): Promise<number> {
  if (!viewer.siteIds.length) return 0;
  return prisma.permit.count({
    where: {
      jobSiteId: { in: viewer.siteIds },
      status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
    },
  });
}

export interface PermitAdminDetail {
  permit: Permit;
  effectiveStatus: PermitStatusValue;
  siteName: string;
  workerName: string;
  workerCompany: string;
  answers: AnsweredQuestion[];
  activities: PermitActivity[];
  canApprove: boolean;
}

export async function getPermitForViewer(
  viewer: PlatformViewer,
  permitId: string,
): Promise<PermitAdminDetail | null> {
  const p = await prisma.permit.findFirst({
    where: { id: permitId, jobSiteId: { in: viewer.siteIds } },
    include: {
      jobSite: { select: { name: true } },
      worker: { select: { fullName: true, company: true } },
      activities: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!p) return null;
  const { jobSite, worker, activities, ...permit } = p;
  return {
    permit,
    effectiveStatus: effectiveStatus(p),
    siteName: jobSite.name,
    workerName: worker.fullName,
    workerCompany: worker.company,
    answers: (p.answers as unknown as AnsweredQuestion[]) ?? [],
    activities,
    canApprove: canApprovePermit(viewer.role),
  };
}

type ActionResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/** Load a scoped permit for a write, enforcing the edit verb + site boundary. */
async function loadForWrite(viewer: PlatformViewer, permitId: string) {
  if (!permits(viewer.role, 'permits', 'edit'))
    return { forbidden: true as const };
  const p = await prisma.permit.findFirst({
    where: { id: permitId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true, status: true },
  });
  return { permit: p };
}

export async function markUnderReview(
  viewer: PlatformViewer,
  permitId: string,
): Promise<ActionResult> {
  const r = await loadForWrite(viewer, permitId);
  if ('forbidden' in r) return { ok: false, reason: 'forbidden' };
  if (!r.permit) return { ok: false, reason: 'not_found' };
  if (r.permit.status !== 'SUBMITTED') {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Only a submitted permit can move to review.',
    };
  }
  await prisma.$transaction([
    prisma.permit.update({
      where: { id: permitId },
      data: {
        status: 'UNDER_REVIEW',
        reviewedByUserId: viewer.id,
        reviewedByName: viewer.name,
        reviewedAt: new Date(),
      },
    }),
    prisma.permitActivity.create({
      data: {
        permitId,
        type: 'UNDER_REVIEW',
        fromValue: permitStatusLabel('SUBMITTED'),
        toValue: permitStatusLabel('UNDER_REVIEW'),
        actorKind: 'platform',
        authorUserId: viewer.id,
        authorName: viewer.name,
      },
    }),
  ]);
  return { ok: true };
}

export async function approvePermit(
  viewer: PlatformViewer,
  permitId: string,
  input: { validFrom?: string | null; validUntil?: string | null },
): Promise<ActionResult> {
  if (!canApprovePermit(viewer.role)) return { ok: false, reason: 'forbidden' };
  const r = await loadForWrite(viewer, permitId);
  if ('forbidden' in r) return { ok: false, reason: 'forbidden' };
  if (!r.permit) return { ok: false, reason: 'not_found' };
  if (r.permit.status !== 'SUBMITTED' && r.permit.status !== 'UNDER_REVIEW') {
    return {
      ok: false,
      reason: 'invalid',
      error: 'This permit is not awaiting approval.',
    };
  }
  const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (
    !validUntil ||
    isNaN(validUntil.getTime()) ||
    isNaN(validFrom.getTime())
  ) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Please set a valid-until date/time.',
    };
  }
  if (validUntil.getTime() <= validFrom.getTime()) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Valid-until must be after valid-from.',
    };
  }
  await prisma.$transaction([
    prisma.permit.update({
      where: { id: permitId },
      data: {
        status: 'APPROVED',
        approvedByUserId: viewer.id,
        approvedByName: viewer.name,
        approvedAt: new Date(),
        validFrom,
        validUntil,
      },
    }),
    prisma.permitActivity.create({
      data: {
        permitId,
        type: 'APPROVED',
        fromValue: permitStatusLabel(r.permit.status),
        toValue: permitStatusLabel('APPROVED'),
        actorKind: 'platform',
        authorUserId: viewer.id,
        authorName: viewer.name,
      },
    }),
  ]);
  return { ok: true };
}

export async function rejectPermit(
  viewer: PlatformViewer,
  permitId: string,
  reason: string,
): Promise<ActionResult> {
  if (!canApprovePermit(viewer.role)) return { ok: false, reason: 'forbidden' };
  const r = await loadForWrite(viewer, permitId);
  if ('forbidden' in r) return { ok: false, reason: 'forbidden' };
  if (!r.permit) return { ok: false, reason: 'not_found' };
  if (r.permit.status !== 'SUBMITTED' && r.permit.status !== 'UNDER_REVIEW') {
    return {
      ok: false,
      reason: 'invalid',
      error: 'This permit is not awaiting approval.',
    };
  }
  const clean = reason?.trim() ?? '';
  if (clean.length < 3) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A rejection reason is required.',
    };
  }
  await prisma.$transaction([
    prisma.permit.update({
      where: { id: permitId },
      data: {
        status: 'REJECTED',
        rejectedByUserId: viewer.id,
        rejectedByName: viewer.name,
        rejectedAt: new Date(),
        rejectionReason: clean.slice(0, REJECTION_REASON_MAX),
      },
    }),
    prisma.permitActivity.create({
      data: {
        permitId,
        type: 'REJECTED',
        fromValue: permitStatusLabel(r.permit.status),
        toValue: permitStatusLabel('REJECTED'),
        note: clean.slice(0, REJECTION_REASON_MAX),
        actorKind: 'platform',
        authorUserId: viewer.id,
        authorName: viewer.name,
      },
    }),
  ]);
  return { ok: true };
}

export async function closePermit(
  viewer: PlatformViewer,
  permitId: string,
): Promise<ActionResult> {
  const r = await loadForWrite(viewer, permitId);
  if ('forbidden' in r) return { ok: false, reason: 'forbidden' };
  if (!r.permit) return { ok: false, reason: 'not_found' };
  if (
    r.permit.status === 'CLOSED' ||
    r.permit.status === 'CANCELLED' ||
    r.permit.status === 'REJECTED'
  ) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'This permit is already closed.',
    };
  }
  await prisma.$transaction([
    prisma.permit.update({
      where: { id: permitId },
      data: {
        status: 'CLOSED',
        closedByUserId: viewer.id,
        closedByName: viewer.name,
        closedAt: new Date(),
      },
    }),
    prisma.permitActivity.create({
      data: {
        permitId,
        type: 'CLOSED',
        fromValue: permitStatusLabel(r.permit.status),
        toValue: permitStatusLabel('CLOSED'),
        actorKind: 'platform',
        authorUserId: viewer.id,
        authorName: viewer.name,
      },
    }),
  ]);
  return { ok: true };
}
