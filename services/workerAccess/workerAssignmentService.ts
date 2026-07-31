import { WorkerAssignmentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import { normaliseUkMobile } from '@/lib/phone';
import { sendAuditedSms } from '@/services/sms/smsSendService';

/**
 * SC-023 Phase 1 — worker invitation and site assignment.
 *
 * THE ACCESS DECISION lives in `canWorkerCheckIn`, and every path that lets a
 * worker onto a site asks it. Enforcement is per site and defaults OFF, so
 * deploying this changes nothing until a Director switches a site on.
 *
 * PHASE 1 RULE: manager assignment + approval is sufficient to grant access.
 * Acceptance is recorded where it happens but is NOT a gate — an undelivered
 * SMS must never block a worker standing at the gate whose manager has already
 * approved them. That matters more than usual right now, because SMS is still
 * on the mock provider and nothing is actually delivered.
 */

export function canManageWorkerAccess(role: PlatformRoleValue): boolean {
  return (
    role === 'DIRECTOR' || role === 'PROJECT_MANAGER' || role === 'SITE_MANAGER'
  );
}

/** Only a Director may switch enforcement on: it can deny site access. */
export function canSetEnforcement(role: PlatformRoleValue): boolean {
  return role === 'DIRECTOR';
}

/* -------------------------------------------------------------------------- */
/* The access decision                                                         */
/* -------------------------------------------------------------------------- */

export type AccessDecision =
  | { allowed: true; enforced: boolean }
  | { allowed: false; reason: string };

/**
 * May this worker check in to this site?
 *
 * Returns a REASON when refusing, never a bare false. A worker turned away at a
 * site gate with an unexplained failure has no way to resolve it; being told
 * "your access is suspended — contact your site manager" is actionable.
 */
export async function canWorkerCheckIn(
  workerId: string,
  siteId: string,
): Promise<AccessDecision> {
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { workerAccessEnforced: true },
  });
  if (!site)
    return { allowed: false, reason: 'That site is no longer available.' };

  // Enforcement off — behave exactly as before SC-023 existed.
  if (!site.workerAccessEnforced) return { allowed: true, enforced: false };

  const assignment = await prisma.workerSiteAssignment.findUnique({
    where: { workerId_jobSiteId: { workerId, jobSiteId: siteId } },
    select: { status: true },
  });

  if (!assignment) {
    return {
      allowed: false,
      reason:
        'You have not been invited to this project. Ask your site manager to invite you before checking in.',
    };
  }
  switch (assignment.status) {
    case WorkerAssignmentStatus.ACTIVE:
      return { allowed: true, enforced: true };
    case WorkerAssignmentStatus.INVITED:
      return {
        allowed: false,
        reason:
          'Your access to this project is awaiting approval. Your site manager needs to approve it before you can check in.',
      };
    case WorkerAssignmentStatus.SUSPENDED:
      return {
        allowed: false,
        reason:
          'Your access to this project has been suspended. Please speak to your site manager.',
      };
    case WorkerAssignmentStatus.REMOVED:
      return {
        allowed: false,
        reason:
          'You are no longer assigned to this project. Ask your site manager if you should be.',
      };
    default:
      return { allowed: false, reason: 'You cannot check in to this project.' };
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface AssignmentRow {
  id: string;
  workerId: string;
  workerName: string;
  company: string;
  mobile: string;
  status: WorkerAssignmentStatus;
  invitationCode: string | null;
  invitedByName: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  backfilled: boolean;
}

export async function listSiteAssignments(
  viewer: PlatformViewer,
  siteId: string,
): Promise<{ enforced: boolean; rows: AssignmentRow[] } | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { workerAccessEnforced: true },
  });
  if (!site) return null;

  const rows = await prisma.workerSiteAssignment.findMany({
    where: { jobSiteId: siteId },
    orderBy: [{ status: 'asc' }, { invitedAt: 'desc' }],
    include: {
      worker: {
        select: { id: true, fullName: true, company: true, mobile: true },
      },
    },
  });

  return {
    enforced: site.workerAccessEnforced,
    rows: rows.map((r) => ({
      id: r.id,
      workerId: r.workerId,
      workerName: r.worker.fullName,
      company: r.worker.company,
      mobile: r.worker.mobile,
      status: r.status,
      invitationCode: r.invitationCode,
      invitedByName: r.invitedByName,
      invitedAt: r.invitedAt,
      acceptedAt: r.acceptedAt,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt,
      backfilled: r.backfilled,
    })),
  };
}

export async function listSiteAccessHistory(
  viewer: PlatformViewer,
  siteId: string,
  take = 50,
) {
  if (!viewer.siteIds.includes(siteId)) return null;
  return prisma.workerAssignmentEvent.findMany({
    where: { jobSiteId: siteId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export type AssignmentResult =
  | {
      ok: true;
      assignmentId: string;
      invitationCode?: string;
      smsDelivered?: boolean;
    }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * A short, readable invitation code.
 *
 * Excludes characters that are misheard or misread when a manager reads one out
 * over site noise — no O/0, I/1, S/5. The fallback only works if the code
 * survives being spoken.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
function makeInvitationCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function guard(
  viewer: PlatformViewer,
  siteId: string,
): Promise<
  | { ok: true; site: { id: string; name: string } }
  | { ok: false; reason: 'forbidden' | 'not_found' }
> {
  if (!canManageWorkerAccess(viewer.role))
    return { ok: false, reason: 'forbidden' };
  if (!permits(viewer.role, 'checkins', 'view'))
    return { ok: false, reason: 'forbidden' };
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };
  return { ok: true, site };
}

async function recordEvent(
  workerId: string | null,
  workerName: string,
  siteId: string | null,
  siteName: string,
  action: string,
  actorName: string,
  detail?: string,
): Promise<void> {
  await prisma.workerAssignmentEvent.create({
    data: {
      workerId,
      workerName,
      jobSiteId: siteId,
      siteName,
      action,
      actorName,
      detail,
    },
  });
}

/**
 * Invite a worker to a project.
 *
 * Creates the Worker record if the mobile is new — that IS the point: a manager
 * pre-registers the person rather than the person self-registering, which is
 * the behaviour SC-023 exists to replace.
 *
 * The SMS is best-effort. A failed or undelivered message does NOT fail the
 * invitation, because the invitation code is also shown to the manager to read
 * out. With SMS on the mock provider that is the only working route, and on a
 * real site with poor signal it will often be the faster one.
 */
export async function inviteWorker(
  viewer: PlatformViewer,
  siteId: string,
  input: { mobile: string; fullName: string; company: string },
): Promise<AssignmentResult> {
  const g = await guard(viewer, siteId);
  if (!g.ok) return g;

  const mobile = normaliseUkMobile(input.mobile ?? '');
  if (!mobile.ok || !mobile.e164) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Enter a valid UK mobile number.',
    };
  }
  const fullName = (input.fullName ?? '').trim();
  const company = (input.company ?? '').trim();
  if (fullName.length < 2) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Enter the worker’s full name.',
    };
  }
  if (company.length < 2) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Enter the worker’s company.',
    };
  }

  // Upsert rather than create: a worker already known to the platform (from
  // another site) must not be duplicated, and their existing record — CSCS
  // verification, induction history — carries over.
  const worker = await prisma.worker.upsert({
    where: { mobile: mobile.e164 },
    create: { mobile: mobile.e164, fullName, company },
    update: {},
    select: { id: true, fullName: true },
  });

  const code = makeInvitationCode();
  const assignment = await prisma.workerSiteAssignment.upsert({
    where: { workerId_jobSiteId: { workerId: worker.id, jobSiteId: siteId } },
    create: {
      workerId: worker.id,
      jobSiteId: siteId,
      status: WorkerAssignmentStatus.INVITED,
      invitationCode: code,
      invitedByUserId: viewer.id,
      invitedByName: viewer.name,
    },
    // Re-inviting someone previously removed or suspended returns them to
    // INVITED rather than silently restoring access — re-approval is deliberate.
    update: {
      status: WorkerAssignmentStatus.INVITED,
      invitationCode: code,
      invitedByUserId: viewer.id,
      invitedByName: viewer.name,
      invitedAt: new Date(),
      suspendedAt: null,
      suspendedByName: null,
      removedAt: null,
      approvedAt: null,
      approvedByName: null,
      backfilled: false,
    },
    select: { id: true },
  });

  const sms = await sendAuditedSms({
    to: mobile.e164,
    purpose: 'WORKER_INVITE',
    workerId: worker.id,
    jobSiteId: siteId,
    actorName: viewer.name,
    message:
      `You have been invited to ${g.site.name} on SiteComply. ` +
      `Your invitation code is ${code}. ` +
      `Sign in at ${process.env.NEXT_PUBLIC_APP_URL ?? 'the SiteComply app'} to complete your induction.`,
  });

  await recordEvent(
    worker.id,
    worker.fullName,
    siteId,
    g.site.name,
    'INVITED',
    viewer.name,
    sms.ok
      ? 'Invitation SMS sent.'
      : `Invitation SMS not delivered: ${sms.error}`,
  );

  return {
    ok: true,
    assignmentId: assignment.id,
    invitationCode: code,
    smsDelivered: sms.ok,
  };
}

async function transition(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
  next: WorkerAssignmentStatus,
  action: string,
  data: Record<string, unknown> = {},
): Promise<AssignmentResult> {
  const g = await guard(viewer, siteId);
  if (!g.ok) return g;

  const existing = await prisma.workerSiteAssignment.findFirst({
    where: { id: assignmentId, jobSiteId: siteId },
    include: { worker: { select: { id: true, fullName: true } } },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  await prisma.workerSiteAssignment.update({
    where: { id: assignmentId },
    data: { status: next, ...data },
  });
  await recordEvent(
    existing.worker.id,
    existing.worker.fullName,
    siteId,
    g.site.name,
    action,
    viewer.name,
  );
  return { ok: true, assignmentId };
}

/** Approve access. In Phase 1 this is what actually grants it. */
export function approveAssignment(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
): Promise<AssignmentResult> {
  return transition(
    viewer,
    siteId,
    assignmentId,
    WorkerAssignmentStatus.ACTIVE,
    'APPROVED',
    {
      approvedByUserId: viewer.id,
      approvedByName: viewer.name,
      approvedAt: new Date(),
      suspendedAt: null,
      suspendedByName: null,
      removedAt: null,
    },
  );
}

/**
 * Suspend access immediately.
 *
 * Takes effect on the worker's next check-in attempt. An OPEN check-in is
 * deliberately left alone: someone already on site must still be able to check
 * out, or the fire register is wrong about who is on the premises.
 */
export function suspendAssignment(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
): Promise<AssignmentResult> {
  return transition(
    viewer,
    siteId,
    assignmentId,
    WorkerAssignmentStatus.SUSPENDED,
    'SUSPENDED',
    { suspendedAt: new Date(), suspendedByName: viewer.name },
  );
}

export function reinstateAssignment(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
): Promise<AssignmentResult> {
  return transition(
    viewer,
    siteId,
    assignmentId,
    WorkerAssignmentStatus.ACTIVE,
    'REINSTATED',
    { suspendedAt: null, suspendedByName: null },
  );
}

/**
 * Remove a worker from a project.
 *
 * The assignment row is RETAINED, not deleted: "view active and historical site
 * assignments" is an explicit requirement, and their check-ins, inductions and
 * permits on this site remain untouched. Removing access must never erase what
 * someone did while they had it.
 */
export function removeAssignment(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
): Promise<AssignmentResult> {
  return transition(
    viewer,
    siteId,
    assignmentId,
    WorkerAssignmentStatus.REMOVED,
    'REMOVED',
    { removedAt: new Date() },
  );
}

/**
 * Switch enforcement for a site. DIRECTOR ONLY — this can deny site access.
 *
 * Turning it ON is refused while workers have checked in here but have no
 * ACTIVE assignment: that configuration would turn people away at the gate the
 * next morning with no warning. The refusal names the count so the Director can
 * invite or backfill them first.
 */
export async function setSiteEnforcement(
  viewer: PlatformViewer,
  siteId: string,
  enabled: boolean,
): Promise<
  | { ok: true; unassigned?: number }
  | { ok: false; reason: string; error?: string }
> {
  if (!canSetEnforcement(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  if (enabled) {
    const known = await prisma.submission.findMany({
      where: { jobSiteId: siteId },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    const active = await prisma.workerSiteAssignment.findMany({
      where: {
        jobSiteId: siteId,
        status: WorkerAssignmentStatus.ACTIVE,
        workerId: { in: known.map((k) => k.workerId) },
      },
      select: { workerId: true },
    });
    const activeIds = new Set(active.map((a) => a.workerId));
    const unassigned = known.filter((k) => !activeIds.has(k.workerId)).length;
    if (unassigned > 0) {
      return {
        ok: false,
        reason: 'blocked',
        error: `${unassigned} worker${unassigned === 1 ? ' has' : 's have'} checked in here but ${unassigned === 1 ? 'is' : 'are'} not approved. Invite or approve them first, or they will be turned away at the gate.`,
      };
    }
  }

  await prisma.jobSite.update({
    where: { id: siteId },
    data: { workerAccessEnforced: enabled },
  });
  await recordEvent(
    null,
    '—',
    siteId,
    site.name,
    enabled ? 'ENFORCEMENT_ON' : 'ENFORCEMENT_OFF',
    viewer.name,
    enabled
      ? 'Only invited and approved workers may now check in.'
      : 'Any worker may check in, as before.',
  );
  return { ok: true };
}

/** Record that a worker accepted — informational in Phase 1, never a gate. */
export async function recordAcceptance(
  workerId: string,
  siteId: string,
): Promise<void> {
  await prisma.workerSiteAssignment
    .updateMany({
      where: { workerId, jobSiteId: siteId, acceptedAt: null },
      data: { acceptedAt: new Date() },
    })
    .catch(() => {});
}
