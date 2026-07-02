import { AccessRequestStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normaliseUkMobile } from '@/lib/phone';

/**
 * Self-service Platform Access Requests. Submitted from the login screen when
 * the entered email/mobile doesn't match a Platform User. Validation lives here;
 * duplicate prevention blocks a request when the identifier already belongs to a
 * Platform User or an existing PENDING request. Approval does not itself create
 * a Platform User (that stays with the admin Platform Users flow).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REASON_MAX = 500;

export interface AccessRequestInput {
  fullName?: string;
  companyName?: string;
  email?: string;
  mobile?: string;
  reason?: string;
}

export interface ValidatedAccessRequest {
  fullName: string;
  companyName: string;
  email: string;
  mobile: string;
  reason: string | null;
}

export type AccessRequestFieldErrors = Partial<
  Record<keyof AccessRequestInput, string>
>;

export function validateAccessRequest(
  input: AccessRequestInput,
):
  | { ok: true; value: ValidatedAccessRequest }
  | { ok: false; errors: AccessRequestFieldErrors } {
  const errors: AccessRequestFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const fullName = text(input.fullName);
  const companyName = text(input.companyName);
  const email = text(input.email).toLowerCase();

  if (fullName.length < 2) errors.fullName = 'Please enter your full name.';
  if (companyName.length < 2)
    errors.companyName = 'Please enter your company name.';
  if (!EMAIL_RE.test(email))
    errors.email = 'Please enter a valid email address.';

  const m = normaliseUkMobile(input.mobile ?? '');
  let mobile = '';
  if (!m.ok || !m.e164) {
    errors.mobile = m.error ?? 'Enter a valid UK mobile number.';
  } else {
    mobile = m.e164;
  }

  const reason = text(input.reason);
  if (reason.length > REASON_MAX)
    errors.reason = `Please keep the reason under ${REASON_MAX} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { fullName, companyName, email, mobile, reason: reason || null },
  };
}

/**
 * Store a request unless the identifier already belongs to a Platform User or a
 * PENDING request (duplicate prevention).
 */
export async function createAccessRequest(
  value: ValidatedAccessRequest,
): Promise<{ ok: true } | { ok: false; reason: 'exists_user' | 'exists_pending' }> {
  const existingUser = await prisma.platformUser.findFirst({
    where: { OR: [{ email: value.email }, { mobile: value.mobile }] },
    select: { id: true },
  });
  if (existingUser) return { ok: false, reason: 'exists_user' };

  const pending = await prisma.platformAccessRequest.findFirst({
    where: {
      status: AccessRequestStatus.PENDING,
      OR: [{ email: value.email }, { mobile: value.mobile }],
    },
    select: { id: true },
  });
  if (pending) return { ok: false, reason: 'exists_pending' };

  await prisma.platformAccessRequest.create({ data: value });
  return { ok: true };
}

export function listAccessRequests(status: AccessRequestStatus) {
  return prisma.platformAccessRequest.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
  });
}

/** Counts per status, for the admin tab badges. */
export async function accessRequestCounts(): Promise<
  Record<AccessRequestStatus, number>
> {
  const grouped = await prisma.platformAccessRequest.groupBy({
    by: ['status'],
    _count: true,
  });
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<
    AccessRequestStatus,
    number
  >;
  for (const g of grouped) counts[g.status] = g._count;
  return counts;
}

export function getAccessRequestById(id: string) {
  return prisma.platformAccessRequest.findUnique({ where: { id } });
}

export function setAccessRequestStatus(id: string, status: AccessRequestStatus) {
  return prisma.platformAccessRequest.update({
    where: { id },
    data: {
      status,
      reviewedAt: status === AccessRequestStatus.PENDING ? null : new Date(),
    },
  });
}
