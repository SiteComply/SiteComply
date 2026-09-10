import {
  WorkerAssignmentStatus,
  AccessRequirement,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import { normaliseUkMobile } from '@/lib/phone';
import { sendAuditedSms } from '@/services/sms/smsSendService';
import { formatDateUK } from '@/lib/datetime';
import { getPanelVisibility } from '@/services/workerDashboard/dashboardConfigService';
import {
  WORKER_DASHBOARD_PANELS,
  WORKER_DASHBOARD_PANEL_VALUES,
} from '@/services/workerDashboard/dashboardPanels';
import {
  ACCESS_REQUIREMENTS,
  evaluateRequirements,
  formatUnmetMessage,
  requirementMeta,
} from '@/services/workerAccess/accessRequirements';
import {
  windowState,
  daysUntilExpiry,
  isExpiringSoon,
  parseAccessDate,
  type WindowState,
} from '@/services/workerAccess/assignmentWindow';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';

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
/**
 * The part of the access decision that needs nothing but the assignment row.
 *
 * Extracted so the site-selection list and canWorkerCheckIn cannot drift: the
 * refusal WORDING lives here once. The list can then mark unavailable sites
 * from a single bulk assignment query instead of running the full check per
 * site, and a worker reads the same sentence in the list that they would read
 * on the site itself.
 *
 * `blocked: false` is NOT the same as "may check in" — an ACTIVE, in-window
 * assignment still has to clear the site's requirements (CSCS and the like),
 * which needs further queries. That is what `requirementsPending` reports, and
 * why the list only ever marks a site UNAVAILABLE, never "available": a false
 * green is worse than no badge.
 */
export type AssignmentGate =
  | { blocked: false; requirementsPending: boolean }
  | { blocked: true; reason: string; short: string };

export function evaluateAssignmentGate(
  assignment: {
    status: WorkerAssignmentStatus;
    startDate: Date | null;
    endDate: Date | null;
  } | null,
): AssignmentGate {
  /*
   * ENFORCEMENT IS NO LONGER OPTIONAL.
   *
   * There used to be a per-site `workerAccessEnforced` switch, plus two
   * organisation-wide overrides, deciding whether an assignment was a record or
   * a gate. It was OFF on every site in production, so it protected nothing it
   * was meant to protect, while making the rule impossible to state simply.
   *
   * A worker is invited and assigned to a project before they work there. That
   * is the workflow, so it is now the behaviour, with no configuration to get
   * wrong. The column and the org settings remain in the schema; nothing reads
   * them for this decision any more.
   */
  if (!assignment) {
    return {
      blocked: true,
      short: 'Not invited',
      reason:
        'You have not been invited to this project. Ask your site manager to invite you before checking in.',
    };
  }

  switch (assignment.status) {
    case WorkerAssignmentStatus.ACTIVE: {
      const state = windowState(assignment.startDate, assignment.endDate);
      if (state === 'pending') {
        return {
          blocked: true,
          short: `Access starts ${formatDateUK(assignment.startDate!)}`,
          reason: `Your access to this project starts on ${formatDateUK(assignment.startDate!)}. Please speak to your site manager if you need access sooner.`,
        };
      }
      if (state === 'expired') {
        return {
          blocked: true,
          short: `Access ended ${formatDateUK(assignment.endDate!)}`,
          reason: `Your access to this project ended on ${formatDateUK(assignment.endDate!)}. Ask your site manager to extend it.`,
        };
      }
      return { blocked: false, requirementsPending: true };
    }
    case WorkerAssignmentStatus.INVITED:
      return {
        blocked: true,
        short: 'Awaiting approval',
        reason:
          'Your access to this project is awaiting approval. Your site manager needs to approve it before you can check in.',
      };
    case WorkerAssignmentStatus.SUSPENDED:
      return {
        blocked: true,
        short: 'Access suspended',
        reason:
          'Your access to this project has been suspended. Please speak to your site manager.',
      };
    case WorkerAssignmentStatus.REMOVED:
      return {
        blocked: true,
        short: 'No longer assigned',
        reason:
          'You are no longer assigned to this project. Ask your site manager if you should be.',
      };
    default:
      return {
        blocked: true,
        short: 'Not available',
        reason: 'You cannot check in to this project.',
      };
  }
}

export async function canWorkerCheckIn(
  workerId: string,
  siteId: string,
): Promise<AccessDecision> {
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    // `name` is selected here rather than re-queried inside the requirements
    // branch, which is one fewer round trip on the path that needs it.
    select: { name: true },
  });
  if (!site)
    return { allowed: false, reason: 'That site is no longer available.' };

    /* Every site requires an invitation. The organisation-wide
     * `invitedWorkersOnly` and `requireActiveSiteAssignment` settings used to
     * raise a floor under the per-site switch; with that switch gone they are
     * strictly redundant and are no longer read here. */
  const assignment = await prisma.workerSiteAssignment.findUnique({
    where: { workerId_jobSiteId: { workerId, jobSiteId: siteId } },
    select: { status: true, startDate: true, endDate: true },
  });

  // Shared with the site-selection list, so both read from one set of words.
  const gate = evaluateAssignmentGate(assignment);
  if (gate.blocked) return { allowed: false, reason: gate.reason };

  // SC-023 Phase 3 — competency and induction requirements, evaluated LAST. A
  // worker whose assignment is fine but whose card has lapsed should be told
  // about the card, not sent looking for an approval problem. This needs more
  // queries, which is why the list cannot cheaply pre-empt it.
  if (gate.requirementsPending) {
    const unmet = await evaluateRequirements(workerId, siteId);
    if (unmet.length > 0) {
      return {
        allowed: false,
        reason: formatUnmetMessage(site.name ?? 'this project', unmet),
      };
    }
  }

  // `enforced` is now always true — every site requires an invitation. Kept on
  // the result so callers reading it do not change meaning.
  return { allowed: true, enforced: true };
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
  invitedByName: string | null;
  invitedAt: Date;
  /** First check-in to this site, derived from attendance history. */
  arrivedAt: Date | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  backfilled: boolean;
  /** SC-023 Phase 2 — recorded only; never affects access or visibility. */
  startDate: Date | null;
  endDate: Date | null;
  /** Derived from the dates on every read — never stored. */
  windowState: WindowState;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  transferredFromSiteName: string | null;
}

export async function listSiteAssignments(
  viewer: PlatformViewer,
  siteId: string,
): Promise<{ enforced: boolean; rows: AssignmentRow[] } | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
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

  /*
   * WHETHER A WORKER HAS ACTUALLY ARRIVED IS DERIVED, NOT STORED.
   *
   * It used to be a stored `acceptedAt` written at check-in, which meant every
   * environment needed a one-off backfill before workers who had been on site
   * for months stopped reading "Invited" — and a stored flag can drift from the
   * attendance history it is supposed to summarise. Attendance history IS the
   * answer, so it is read directly: one aggregate for the whole site.
   */
  const firstCheckIns = await prisma.submission.groupBy({
    by: ['workerId'],
    where: { jobSiteId: siteId },
    _min: { checkedInAt: true },
  });
  const arrivedAt = new Map(
    firstCheckIns.map((f) => [f.workerId, f._min.checkedInAt ?? null]),
  );

  return {
    // Always true now: every site requires an invitation.
    enforced: true,
    rows: rows.map((r) => ({
      id: r.id,
      workerId: r.workerId,
      workerName: r.worker.fullName,
      company: r.worker.company,
      mobile: r.worker.mobile,
      status: r.status,
      invitedByName: r.invitedByName,
      invitedAt: r.invitedAt,
      // Their first check-in to THIS site, or null if they have never arrived.
      arrivedAt: arrivedAt.get(r.workerId) ?? null,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt,
      backfilled: r.backfilled,
      startDate: r.startDate,
      endDate: r.endDate,
      windowState: windowState(r.startDate, r.endDate),
      daysUntilExpiry: daysUntilExpiry(r.endDate),
      // Only meaningful for someone who currently HAS access — warning about a
      // suspended worker's expiry date would be noise.
      expiringSoon:
        r.status === WorkerAssignmentStatus.ACTIVE && isExpiringSoon(r.endDate),
      transferredFromSiteName: r.transferredFromSiteName,
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
      smsDelivered?: boolean;
      /**
       * Set when the mobile already belonged to a worker. The invite does NOT
       * overwrite their name or company, so the manager is told which details
       * will actually be used rather than the ones they just typed.
       */
      existingWorker?: { fullName: string; company: string | null };
      /** True when the invitation granted access outright — see inviteWorker. */
      autoApproved?: boolean;
    }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * Where to send the worker.
 *
 * Reads APP_BASE_URL, which is the variable actually set on the App Service. The
 * previous code read NEXT_PUBLIC_APP_URL, which is NOT set in production, so
 * every invitation SMS fell through to the literal words "the SiteComply app" and
 * carried no link at all.
 */
function appUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.sitecomply.co.uk').replace(/\/+$/, '');
}

/*
 * The invitation code has been REMOVED.
 *
 * It was generated, stored, texted to the worker and shown to the manager — and
 * never read back anywhere in the product. There was no field to enter it and no
 * lookup against it, so the "read it out if the text does not arrive" instruction
 * on the invite dialog asked managers to perform an action that could not work.
 *
 * It could not be rescued as a fallback either: signing in requires an OTP that
 * is itself delivered by SMS, so a worker whose text never arrives cannot get in
 * regardless of what code they hold.
 *
 * `WorkerSiteAssignment.invitationCode` is deliberately left in the schema. It is
 * nullable, nothing reads it, and dropping it would need a hand-applied migration
 * for no behavioural gain. New rows simply leave it null.
 */

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

  // Read BEFORE the upsert: whether this mobile is already known decides what
  // the manager is told, and the existing assignment's status decides whether
  // this invitation can grant access outright.
  const priorWorker = await prisma.worker.findUnique({
    where: { mobile: mobile.e164 },
    select: { id: true, fullName: true, company: true },
  });
  const priorAssignment = priorWorker
    ? await prisma.workerSiteAssignment.findUnique({
        where: { workerId_jobSiteId: { workerId: priorWorker.id, jobSiteId: siteId } },
        select: { status: true },
      })
    : null;

  // Upsert rather than create: a worker already known to the platform (from
  // another site) must not be duplicated, and their existing record — CSCS
  // verification, induction history — carries over.
  //
  // `update: {}` is deliberate and stays. A re-invitation must not overwrite a
  // record carrying verified competency. What was WRONG was doing that silently:
  // the manager typed a name and company that were validated and then discarded
  // without a word. The values are returned to the caller instead, so the invite
  // dialog can say which details will actually be used.
  const worker = await prisma.worker.upsert({
    where: { mobile: mobile.e164 },
    create: { mobile: mobile.e164, fullName, company },
    update: {},
    select: { id: true, fullName: true },
  });

  /*
   * APPROVAL, and when it is skipped.
   *
   * Inviting and approving require the IDENTICAL permission — both call guard(),
   * which checks canManageWorkerAccess plus site scope. So for a first
   * invitation the approval step was the same person clicking again: ceremony,
   * not control, and it left workers stuck at "Awaiting approval" after a
   * manager had already decided they should be on site.
   *
   * It is NOT ceremony in two cases, and both are preserved:
   *
   *   SUSPENDED — access was withdrawn, possibly for a safety or conduct
   *               reason. Re-inviting must not silently restore it.
   *   REMOVED   — the same, and the removal was explicit.
   *
   * Transfers between sites are also untouched (see transferAssignment): the
   * RECEIVING site's manager must still approve, or one site could push a worker
   * onto another site's roster without their consent.
   *
   * This does not weaken site safety. Competency and induction requirements are
   * evaluated separately and afterwards, in canWorkerCheckIn — an auto-approved
   * worker with a lapsed CSCS card still cannot check in.
   */
  const needsExplicitApproval =
    priorAssignment?.status === WorkerAssignmentStatus.SUSPENDED ||
    priorAssignment?.status === WorkerAssignmentStatus.REMOVED;

  const status = needsExplicitApproval
    ? WorkerAssignmentStatus.INVITED
    : WorkerAssignmentStatus.ACTIVE;
  const approval = needsExplicitApproval
    ? { approvedAt: null, approvedByUserId: null, approvedByName: null }
    : {
        approvedAt: new Date(),
        approvedByUserId: viewer.id,
        approvedByName: viewer.name,
      };

  const assignment = await prisma.workerSiteAssignment.upsert({
    where: { workerId_jobSiteId: { workerId: worker.id, jobSiteId: siteId } },
    create: {
      workerId: worker.id,
      jobSiteId: siteId,
      status,
      invitedByUserId: viewer.id,
      invitedByName: viewer.name,
      ...approval,
    },
    update: {
      status,
      invitedByUserId: viewer.id,
      invitedByName: viewer.name,
      invitedAt: new Date(),
      suspendedAt: null,
      suspendedByName: null,
      removedAt: null,
      backfilled: false,
      ...approval,
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
      `Sign in at ${appUrl()} to complete your induction.`,
  });

  const smsNote = sms.ok
    ? 'Invitation SMS sent.'
    : `Invitation SMS not delivered: ${sms.error}`;

  await recordEvent(
    worker.id,
    worker.fullName,
    siteId,
    g.site.name,
    'INVITED',
    viewer.name,
    needsExplicitApproval
      ? `${smsNote} Previously ${priorAssignment?.status.toLowerCase()} — approval required.`
      : smsNote,
  );

  // Auto-approval is recorded as its own event. Access changing hands should be
  // visible in the history as an approval, not inferred from an invitation.
  if (!needsExplicitApproval) {
    await recordEvent(
      worker.id,
      worker.fullName,
      siteId,
      g.site.name,
      'APPROVED',
      viewer.name,
      'Approved automatically — granted by the manager who sent the invitation.',
    );
  }

  return {
    ok: true,
    assignmentId: assignment.id,
    smsDelivered: sms.ok,
    // Only when the mobile was already known: these are the details that will be
    // used, which are NOT the ones the manager just typed.
    ...(priorWorker
      ? { existingWorker: { fullName: priorWorker.fullName, company: priorWorker.company } }
      : {}),
    autoApproved: !needsExplicitApproval,
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

/*
 * setSiteEnforcement() was here.
 *
 * It also REFUSED to switch enforcement on while anyone had checked in without
 * an approved assignment — "they will be turned away at the gate". Enforcement
 * is now unconditional, so that guard has no moment to run in. Its job moves to
 * scripts/backfill_assignments_from_checkins.ts, which must be run once so the
 * people already working on a site keep their access.
 *
 * `JobSite.workerAccessEnforced` remains in the schema, unread.
 */

/*
 * recordAcceptance() was here.
 *
 * It wrote `acceptedAt` at check-in so the roster could say Active. That is now
 * DERIVED from attendance history in listSiteAssignments — the check-ins are the
 * answer, so summarising them into a second column only created something that
 * needed backfilling in every environment and could drift from what it copied.
 * `WorkerSiteAssignment.acceptedAt` remains in the schema, unwritten and unread.
 */

/* -------------------------------------------------------------------------- */
/* Phase 2 — details, transfers, per-worker panels                              */
/* -------------------------------------------------------------------------- */

/**
 * Set the access window for an assignment.
 *
 * These dates DO gate access: outside the window the worker is refused at
 * check-in and told when it starts or ended. Optional; clearing both restores
 * unrestricted access.
 *
 * A recorded `role` used to be set here too. Nothing ever read it, so it has been
 * removed from the workflow — see the note in the body.
 */
export async function setAssignmentDetails(
  viewer: PlatformViewer,
  siteId: string,
  assignmentId: string,
  input: {
    role?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<AssignmentResult> {
  const g = await guard(viewer, siteId);
  if (!g.ok) return g;

  const existing = await prisma.workerSiteAssignment.findFirst({
    where: { id: assignmentId, jobSiteId: siteId },
    include: { worker: { select: { id: true, fullName: true } } },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  // `role` is no longer accepted. It was recorded and never read — no
  // permission, gate, report or workflow consumed it — and it sat unset on 26 of
  // 27 assignments. The column and enum stay in the schema, now unwritten.
  const startDate = parseAccessDate(input.startDate);
  const endDate = parseAccessDate(input.endDate);

  // An end before a start is never what anyone means, and would silently deny
  // access on every future day.
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'The end date cannot be before the start date.',
    };
  }

  await prisma.workerSiteAssignment.update({
    where: { id: assignmentId },
    data: { startDate, endDate },
  });

  const detail = [
    startDate ? `from ${formatDateUK(startDate)}` : 'no start date',
    endDate ? `to ${formatDateUK(endDate)} inclusive` : 'no end date',
  ].join(', ');
  await recordEvent(
    existing.worker.id,
    existing.worker.fullName,
    siteId,
    g.site.name,
    'DETAILS_UPDATED',
    viewer.name,
    detail,
  );
  return { ok: true, assignmentId };
}

/**
 * Transfer a worker from one project to another.
 *
 * The destination assignment arrives INVITED and needs approving there: the
 * destination site's manager owns who is on their site, and a transfer must not
 * be a way to place people onto a project without that manager's knowledge.
 *
 * The source assignment is REMOVED rather than deleted, and the worker's
 * check-ins, inductions and permits on the source site are untouched — moving
 * someone must never erase what they did.
 *
 * Both sides are audited, in one transaction with the change itself.
 */
export async function transferWorker(
  viewer: PlatformViewer,
  fromSiteId: string,
  assignmentId: string,
  toSiteId: string,
): Promise<AssignmentResult> {
  const from = await guard(viewer, fromSiteId);
  if (!from.ok) return from;
  // The actor must hold the DESTINATION site too — otherwise a manager could
  // push workers onto sites they have no authority over.
  const to = await guard(viewer, toSiteId);
  if (!to.ok) {
    return {
      ok: false,
      reason: 'forbidden',
      error: 'You can only transfer workers to a site you manage.',
    };
  }
  if (fromSiteId === toSiteId) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Choose a different project.',
    };
  }

  const existing = await prisma.workerSiteAssignment.findFirst({
    where: { id: assignmentId, jobSiteId: fromSiteId },
    include: { worker: { select: { id: true, fullName: true } } },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const [, created] = await prisma.$transaction([
    prisma.workerSiteAssignment.update({
      where: { id: assignmentId },
      data: { status: WorkerAssignmentStatus.REMOVED, removedAt: new Date() },
    }),
    prisma.workerSiteAssignment.upsert({
      where: {
        workerId_jobSiteId: {
          workerId: existing.workerId,
          jobSiteId: toSiteId,
        },
      },
      create: {
        workerId: existing.workerId,
        jobSiteId: toSiteId,
        status: WorkerAssignmentStatus.INVITED,
        invitedByUserId: viewer.id,
        invitedByName: viewer.name,
        // The DATES do not travel: an access window agreed for one project says
        // nothing about another. The recorded role no longer travels either — it
        // is no longer written anywhere.
        transferredFromSiteName: from.site.name,
      },
      update: {
        status: WorkerAssignmentStatus.INVITED,
        invitedByUserId: viewer.id,
        invitedByName: viewer.name,
        invitedAt: new Date(),
        startDate: null,
        endDate: null,
        suspendedAt: null,
        suspendedByName: null,
        removedAt: null,
        approvedAt: null,
        approvedByName: null,
        transferredFromSiteName: from.site.name,
      },
      select: { id: true },
    }),
    prisma.workerAssignmentEvent.create({
      data: {
        workerId: existing.worker.id,
        workerName: existing.worker.fullName,
        jobSiteId: fromSiteId,
        siteName: from.site.name,
        action: 'TRANSFERRED_OUT',
        actorName: viewer.name,
        detail: `Transferred to ${to.site.name}.`,
      },
    }),
    prisma.workerAssignmentEvent.create({
      data: {
        workerId: existing.worker.id,
        workerName: existing.worker.fullName,
        jobSiteId: toSiteId,
        siteName: to.site.name,
        action: 'TRANSFERRED_IN',
        actorName: viewer.name,
        detail: `Transferred from ${from.site.name}. Awaiting approval.`,
      },
    }),
  ]);

  // Transfers still require the RECEIVING site's manager to approve. One site
  // must not be able to place a worker on another site's roster unilaterally.
  return { ok: true, assignmentId: created.id, autoApproved: false };
}

/* -------------------------------------------------------------------------- */
/* Per-worker panel visibility                                                  */
/* -------------------------------------------------------------------------- */

export interface WorkerPanelRow {
  panel: string;
  /** What the SITE allows — the ceiling this worker cannot exceed. */
  siteEnabled: boolean;
  /** What this worker actually sees. */
  effective: boolean;
  overridden: boolean;
  locked: boolean;
}

/**
 * A worker's panel settings for a site, with the site's own setting alongside.
 *
 * Showing both makes the narrow-only rule visible: a panel the site hides
 * renders as unavailable rather than as an unticked box that looks switchable.
 */
export async function getWorkerPanels(
  viewer: PlatformViewer,
  siteId: string,
  workerId: string,
): Promise<WorkerPanelRow[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const [siteVisibility, overrides] = await Promise.all([
    getPanelVisibility(siteId),
    prisma.workerPanelSetting.findMany({
      where: {
        workerId,
        jobSiteId: siteId,
        panel: { in: WORKER_DASHBOARD_PANEL_VALUES },
      },
      select: { panel: true, enabled: true },
    }),
  ]);
  const byPanel = new Map(overrides.map((o) => [o.panel as string, o.enabled]));

  return WORKER_DASHBOARD_PANELS.map((p) => {
    const siteEnabled = siteVisibility[p.value];
    const override = byPanel.get(p.value);
    return {
      panel: p.value,
      siteEnabled,
      // NARROW-ONLY: intersected, so an override can only ever remove.
      effective: siteEnabled && (override ?? true),
      overridden: override !== undefined,
      locked: p.locked === true,
    };
  });
}

/** Hide or restore one panel for one worker on one site. */
export async function setWorkerPanel(
  viewer: PlatformViewer,
  siteId: string,
  workerId: string,
  panel: string,
  enabled: boolean,
): Promise<AssignmentResult> {
  const g = await guard(viewer, siteId);
  if (!g.ok) return g;

  const meta = WORKER_DASHBOARD_PANELS.find((p) => p.value === panel);
  if (!meta) {
    return { ok: false, reason: 'invalid', error: 'Unknown panel.' };
  }
  if (meta.locked && !enabled) {
    // Check out is locked for the same reason as in SC-003: hiding it would
    // leave a worker unable to end their attendance record, and the site's fire
    // register wrong about who is on the premises.
    return {
      ok: false,
      reason: 'invalid',
      error: `${meta.label} cannot be hidden — a worker must always be able to check out.`,
    };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, fullName: true },
  });
  if (!worker) return { ok: false, reason: 'not_found' };

  if (enabled) {
    // Back to the site default: delete rather than store a no-op, so
    // "overridden" keeps meaning "deliberately restricted".
    await prisma.workerPanelSetting.deleteMany({
      where: { workerId, jobSiteId: siteId, panel: panel as never },
    });
  } else {
    await prisma.workerPanelSetting.upsert({
      where: {
        workerId_jobSiteId_panel: {
          workerId,
          jobSiteId: siteId,
          panel: panel as never,
        },
      },
      create: {
        workerId,
        jobSiteId: siteId,
        panel: panel as never,
        enabled: false,
        updatedByUserId: viewer.id,
        updatedByName: viewer.name,
      },
      update: {
        enabled: false,
        updatedByUserId: viewer.id,
        updatedByName: viewer.name,
      },
    });
  }

  await recordEvent(
    worker.id,
    worker.fullName,
    siteId,
    g.site.name,
    enabled ? 'PANEL_RESTORED' : 'PANEL_HIDDEN',
    viewer.name,
    meta.label,
  );
  return { ok: true, assignmentId: '' };
}

/* -------------------------------------------------------------------------- */
/* Phase 3 — site access requirements                                           */
/* -------------------------------------------------------------------------- */

export interface RequirementRow {
  requirement: AccessRequirement;
  label: string;
  description: string;
  blocksFirstTime: boolean;
  enabled: boolean;
  /** How many currently-assigned workers do not meet it right now. */
  blockedCount: number;
  blockedNames: string[];
}

/**
 * The site's requirements, each with a LIVE count of who would be blocked.
 *
 * The count is computed on every read rather than cached, so the number a
 * manager sees is the number that would actually bite — a stale figure here
 * would be worse than none.
 */
export async function listSiteRequirements(
  viewer: PlatformViewer,
  siteId: string,
): Promise<RequirementRow[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const [stored, assignments] = await Promise.all([
    prisma.siteAccessRequirement.findMany({ where: { jobSiteId: siteId } }),
    prisma.workerSiteAssignment.findMany({
      where: { jobSiteId: siteId, status: WorkerAssignmentStatus.ACTIVE },
      include: { worker: { select: { id: true, fullName: true } } },
    }),
  ]);
  const enabledMap = new Map(stored.map((r) => [r.requirement, r.enabled]));

  const rows: RequirementRow[] = [];
  for (const meta of ACCESS_REQUIREMENTS) {
    // Evaluate this requirement ALONE against each worker, so the count answers
    // "who does this one requirement block?" rather than being confounded by
    // the others already switched on.
    const blocked = await blockedByRequirement(
      siteId,
      meta.requirement,
      assignments.map((a) => ({ id: a.worker.id, name: a.worker.fullName })),
    );
    rows.push({
      requirement: meta.requirement,
      label: meta.label,
      description: meta.description,
      blocksFirstTime: meta.blocksFirstTime,
      enabled: enabledMap.get(meta.requirement) ?? false,
      blockedCount: blocked.length,
      blockedNames: blocked.map((b) => b.name),
    });
  }
  return rows;
}

/** Who a single requirement would refuse, ignoring whatever else is enabled. */
async function blockedByRequirement(
  siteId: string,
  requirement: AccessRequirement,
  workers: { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const w of workers) {
    const unmet = await evaluateOne(w.id, siteId, requirement);
    if (unmet) out.push(w);
  }
  return out;
}

/**
 * Evaluate ONE requirement against one worker, as if only it were enabled.
 *
 * Implemented by enabling it in memory rather than duplicating the rules, so
 * the preview and the real gate can never disagree — a preview that lies is
 * worse than no preview.
 */
async function evaluateOne(
  workerId: string,
  siteId: string,
  requirement: AccessRequirement,
): Promise<boolean> {
  const existing = await prisma.siteAccessRequirement.findUnique({
    where: { jobSiteId_requirement: { jobSiteId: siteId, requirement } },
    select: { enabled: true },
  });
  if (existing?.enabled) {
    const unmet = await evaluateRequirements(workerId, siteId);
    return unmet.some((u) => u.requirement === requirement);
  }
  // Not currently enabled: turn it on, measure, put it back. Wrapped so a
  // failure cannot leave a requirement switched on that nobody chose.
  try {
    await prisma.siteAccessRequirement.upsert({
      where: { jobSiteId_requirement: { jobSiteId: siteId, requirement } },
      create: { jobSiteId: siteId, requirement, enabled: true },
      update: { enabled: true },
    });
    const unmet = await evaluateRequirements(workerId, siteId);
    return unmet.some((u) => u.requirement === requirement);
  } finally {
    await prisma.siteAccessRequirement
      .update({
        where: { jobSiteId_requirement: { jobSiteId: siteId, requirement } },
        data: { enabled: existing?.enabled ?? false },
      })
      .catch(() => {});
  }
}

export type RequirementResult =
  | { ok: true; blockedAtEnable?: number }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid' | 'preview_required';
      error?: string;
      preview?: { count: number; names: string[] };
    };

/**
 * Enable or disable a requirement.
 *
 * ENABLING REQUIRES AN EXPLICIT CONFIRMATION carrying the preview. Without
 * `confirm`, this returns who would be blocked and changes nothing. The
 * mandatory preview is enforced HERE rather than in the UI, so it cannot be
 * skipped by calling the API directly — turning workers away is not something
 * to do by accident.
 *
 * Disabling never needs confirmation: removing a restriction cannot lock
 * anyone out.
 */
export async function setSiteRequirement(
  viewer: PlatformViewer,
  siteId: string,
  requirement: AccessRequirement,
  enabled: boolean,
  confirm = false,
): Promise<RequirementResult> {
  const g = await guard(viewer, siteId);
  if (!g.ok) return g;
  if (!ACCESS_REQUIREMENTS.some((r) => r.requirement === requirement)) {
    return { ok: false, reason: 'invalid', error: 'Unknown requirement.' };
  }

  if (enabled && !confirm) {
    const assignments = await prisma.workerSiteAssignment.findMany({
      where: { jobSiteId: siteId, status: WorkerAssignmentStatus.ACTIVE },
      include: { worker: { select: { id: true, fullName: true } } },
    });
    const blocked = await blockedByRequirement(
      siteId,
      requirement,
      assignments.map((a) => ({ id: a.worker.id, name: a.worker.fullName })),
    );
    return {
      ok: false,
      reason: 'preview_required',
      preview: { count: blocked.length, names: blocked.map((b) => b.name) },
    };
  }

  let blockedAtEnable: number | undefined;
  if (enabled) {
    const assignments = await prisma.workerSiteAssignment.findMany({
      where: { jobSiteId: siteId, status: WorkerAssignmentStatus.ACTIVE },
      include: { worker: { select: { id: true, fullName: true } } },
    });
    blockedAtEnable = (
      await blockedByRequirement(
        siteId,
        requirement,
        assignments.map((a) => ({ id: a.worker.id, name: a.worker.fullName })),
      )
    ).length;
  }

  await prisma.siteAccessRequirement.upsert({
    where: { jobSiteId_requirement: { jobSiteId: siteId, requirement } },
    create: {
      jobSiteId: siteId,
      requirement,
      enabled,
      blockedAtEnable: blockedAtEnable ?? null,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
    update: {
      enabled,
      blockedAtEnable: enabled ? (blockedAtEnable ?? null) : null,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
  });

  await recordEvent(
    null,
    '—',
    siteId,
    g.site.name,
    enabled ? 'REQUIREMENT_ON' : 'REQUIREMENT_OFF',
    viewer.name,
    `${requirementMeta(requirement).label}${enabled ? ` — ${blockedAtEnable} worker(s) did not meet it at the time` : ''}`,
  );
  return { ok: true, blockedAtEnable };
}

/* -------------------------------------------------------------------------- */
/* Site-selection hints                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Per-site access state for the worker's site-selection list.
 *
 * Costs a fixed number of queries for the WHOLE list — one config read, one
 * bulk assignment query, one bulk requirements query — rather than a full
 * access check per site, by reusing evaluateAssignmentGate. The label shown
 * against a site therefore comes from the same function as the sentence they
 * would meet on the site itself, and the two cannot drift.
 *
 * THREE STATES, and the distinction between the last two is the honest bit:
 *
 *  blocked  — refused by the assignment rules. Short label for the list, full
 *             sentence for the site page.
 *  granted  — the assignment check passed AND this site has no access
 *             requirements configured, so there is nothing further to fail:
 *             "Access Granted" is a claim we can actually make.
 *  unknown  — the assignment check passed but the site HAS requirements (a
 *             verified card, a passed knowledge check). Those need per-worker
 *             queries this deliberately avoids, so the site is neither blocked
 *             nor promised, and carries no badge. Promising access and then
 *             refusing it on arrival would be worse than saying nothing.
 */
export type SiteAccessHint =
  | { state: 'blocked'; short: string; full: string }
  | { state: 'granted' }
  | { state: 'unknown' };

export async function siteAccessHintsForWorker(
  workerId: string,
  sites: { id: string }[],
): Promise<Map<string, SiteAccessHint>> {
  const hints = new Map<string, SiteAccessHint>();
  if (sites.length === 0) return hints;

  // Every site enforces now, so every site is hinted.
  const enforcing = sites;
  const ids = enforcing.map((s) => s.id);
  const [assignments, withRequirements] = await Promise.all([
    prisma.workerSiteAssignment.findMany({
      where: { workerId, jobSiteId: { in: ids } },
      select: { jobSiteId: true, status: true, startDate: true, endDate: true },
    }),
    // Which of these sites has ANY requirement switched on. evaluateRequirements
    // returns immediately for a site with none, so "no rows here" means the
    // assignment check was the whole check.
    prisma.siteAccessRequirement.findMany({
      where: { jobSiteId: { in: ids }, enabled: true },
      select: { jobSiteId: true },
      distinct: ['jobSiteId'],
    }),
  ]);

  const bySite = new Map(assignments.map((a) => [a.jobSiteId, a]));
  const gated = new Set(withRequirements.map((r) => r.jobSiteId));

  for (const site of enforcing) {
    const gate = evaluateAssignmentGate(bySite.get(site.id) ?? null);
    if (gate.blocked) {
      hints.set(site.id, {
        state: 'blocked',
        short: gate.short,
        full: gate.reason,
      });
    } else {
      hints.set(site.id, {
        state: gated.has(site.id) ? 'unknown' : 'granted',
      });
    }
  }
  return hints;
}

