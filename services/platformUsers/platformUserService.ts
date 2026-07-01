import { PlatformRole, PlatformUserStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normaliseUkMobile } from '@/lib/phone';
import {
  PLATFORM_ROLES,
  PLATFORM_STATUSES,
} from '@/services/platformUsers/platformUserConstants';

/**
 * Admin-side management of Platform Users (office/management accounts that will
 * sign in via Platform Login). This is the foundation for RBAC and Platform
 * Login access: it stores who a user is, their role and the sites they are
 * assigned to, plus a lifecycle status (pending → active/disabled).
 *
 * Validation lives here so the API and any future caller share one source of
 * truth. Authentication and permission enforcement are NOT implemented yet.
 * Role/status option lists live in ./platformUserConstants (client-safe).
 */

const VALID_ROLES = new Set<string>(PLATFORM_ROLES.map((r) => r.value));
const VALID_STATUSES = new Set<string>(PLATFORM_STATUSES.map((s) => s.value));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PlatformUserInput {
  name?: string;
  company?: string;
  email?: string;
  mobile?: string;
  role?: string;
  status?: string;
  assignedSiteIds?: string[];
}

export interface ValidatedPlatformUser {
  name: string;
  company: string;
  email: string;
  mobile: string | null;
  role: PlatformRole;
  status: PlatformUserStatus;
  assignedSiteIds: string[];
}

export type PlatformUserFieldErrors = Partial<
  Record<keyof PlatformUserInput, string>
>;

/**
 * Validate & normalise platform-user input. Email is lower-cased; mobile
 * (optional) is normalised to E.164. Status defaults to PENDING when omitted.
 */
export function validatePlatformUser(
  input: PlatformUserInput,
):
  | { ok: true; value: ValidatedPlatformUser }
  | { ok: false; errors: PlatformUserFieldErrors } {
  const errors: PlatformUserFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const name = text(input.name);
  const company = text(input.company);
  const email = text(input.email).toLowerCase();

  if (name.length < 2) errors.name = 'Please enter the user’s name.';
  if (company.length < 2) errors.company = 'Please enter the company.';
  if (!EMAIL_RE.test(email))
    errors.email = 'Please enter a valid email address.';

  let mobile: string | null = null;
  if (text(input.mobile)) {
    const m = normaliseUkMobile(input.mobile!);
    if (!m.ok || !m.e164) {
      errors.mobile = m.error ?? 'Enter a valid UK mobile number.';
    } else {
      mobile = m.e164;
    }
  }

  const role = text(input.role);
  if (!VALID_ROLES.has(role)) errors.role = 'Please choose a role.';

  const statusRaw = text(input.status);
  let status: PlatformUserStatus = PlatformUserStatus.PENDING;
  if (statusRaw) {
    if (!VALID_STATUSES.has(statusRaw)) {
      errors.status = 'Please choose a valid status.';
    } else {
      status = statusRaw as PlatformUserStatus;
    }
  }

  const assignedSiteIds = Array.isArray(input.assignedSiteIds)
    ? input.assignedSiteIds.filter((s): s is string => typeof s === 'string')
    : [];

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      company,
      email,
      mobile,
      role: role as PlatformRole,
      status,
      assignedSiteIds,
    },
  };
}

/** All platform users for the admin list, with their assigned sites. */
export function listPlatformUsers() {
  return prisma.platformUser.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: { assignedSites: { select: { id: true, name: true } } },
  });
}

export function getPlatformUserById(id: string) {
  return prisma.platformUser.findUnique({
    where: { id },
    include: { assignedSites: { select: { id: true, name: true } } },
  });
}

export function createPlatformUser(value: ValidatedPlatformUser) {
  const { assignedSiteIds, ...rest } = value;
  return prisma.platformUser.create({
    data: {
      ...rest,
      assignedSites: { connect: assignedSiteIds.map((id) => ({ id })) },
    },
  });
}

export function updatePlatformUser(id: string, value: ValidatedPlatformUser) {
  const { assignedSiteIds, ...rest } = value;
  return prisma.platformUser.update({
    where: { id },
    data: {
      ...rest,
      assignedSites: { set: assignedSiteIds.map((id) => ({ id })) },
    },
  });
}

export function setPlatformUserStatus(id: string, status: PlatformUserStatus) {
  return prisma.platformUser.update({ where: { id }, data: { status } });
}

export function deletePlatformUser(id: string) {
  return prisma.platformUser.delete({ where: { id } });
}

/** Active sites offered for assignment in the add/edit form. */
export function listSitesForAssignment() {
  return prisma.jobSite.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, jobReference: true },
  });
}
