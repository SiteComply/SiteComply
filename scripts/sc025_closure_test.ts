/**
 * SC-025 — project completion, read-only enforcement, and reopening.
 *
 * The assertions that matter:
 *   - closure is REFUSED while workers are on site or permits are live;
 *   - closure with overridable warnings records what was overridden;
 *   - a completed project is genuinely read-only, including via code paths that
 *     never heard of SC-025 (that is what the Prisma guard is for);
 *   - the close-out pack still works, because the requirement says it must;
 *   - reopening is Director-only, needs a reason, and restores exactly the
 *     access that closure suspended.
 *
 * Fixtures are created and removed inside the run.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
  closeProject,
  reopenProject,
  listClosureEvents,
} from '@/services/projectClosure/closureService';
import { buildClosureChecklist } from '@/services/projectClosure/closureChecklist';
import { ProjectClosedError } from '@/services/projectClosure/projectWritable';
import type { PlatformViewer } from '@/services/platformUsers/platformViewerTypes';

/** A raw client, so teardown is not itself blocked by the guard. */
const raw = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

const SUFFIX = randomBytes(4).toString('hex');
const ids: Record<string, string> = {};

function viewerFor(role: string, siteIds: string[]): PlatformViewer {
  return {
    id: ids.director ?? 'u',
    name: `SC025 ${role}`,
    company: 'SiteComply Test',
    role: role as PlatformViewer['role'],
    allSites: role === 'DIRECTOR',
    siteIds,
    sites: [],
    overrides: {},
    companyDefaults: {},
  };
}

async function setup() {
  const admin = await raw.admin.findFirst({ select: { id: true } });
  if (!admin) throw new Error('No Admin row to attribute fixtures to.');

  const site = await raw.jobSite.create({
    data: {
      name: `SC025 Closure Test ${SUFFIX}`,
      jobReference: `SC025-${SUFFIX}`,
      addressLine1: '1 Closure Way',
      town: 'Testville',
      postcode: 'TE1 1ST',
      status: 'ACTIVE',
      createdByAdmin: { connect: { id: admin.id } },
    },
    select: { id: true },
  });
  ids.site = site.id;

  // A second, deliberately OPEN project — the control for proving the guard is
  // scoped rather than global.
  const otherSite = await raw.jobSite.create({
    data: {
      name: `SC025 Control Site ${SUFFIX}`,
      jobReference: `SC025-CTL-${SUFFIX}`,
      addressLine1: '2 Control Way',
      town: 'Testville',
      postcode: 'TE1 2ST',
      status: 'ACTIVE',
      createdByAdmin: { connect: { id: admin.id } },
    },
    select: { id: true },
  });
  ids.otherSite = otherSite.id;

  const director = await raw.platformUser.create({
    data: {
      name: `SC025 Director ${SUFFIX}`,
      email: `sc025.${SUFFIX}@example.test`,
      company: 'SiteComply Test',
      role: 'DIRECTOR',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  ids.director = director.id;

  const worker = await raw.worker.create({
    data: {
      fullName: `SC025 Worker ${SUFFIX}`,
      mobile: `+4477${Math.floor(10000000 + Math.random() * 89999999)}`,
      company: 'Test Contractor',
    },
    select: { id: true },
  });
  ids.worker = worker.id;

  // An open check-in — the first blocker.
  const sub = await raw.submission.create({
    data: {
      jobSiteId: site.id,
      workerId: worker.id,
      answers: {},
      checklistVersion: 1,
    },
    select: { id: true },
  });
  ids.submission = sub.id;

  const assignment = await raw.workerSiteAssignment.create({
    data: {
      jobSiteId: site.id,
      workerId: worker.id,
      status: 'ACTIVE',
      invitedByName: 'SC025 Setup',
    },
    select: { id: true },
  });
  ids.assignment = assignment.id;

  const action = await raw.action.create({
    data: {
      jobSiteId: site.id,
      title: 'SC025 open action',
      description: 'Left open deliberately to exercise the warning path.',
      status: 'OPEN',
      priority: 'MEDIUM',
      assignedTo: 'Someone',
      createdByName: 'SC025 Setup',
      dueDate: new Date(Date.now() + 86400_000),
    },
    select: { id: true },
  });
  ids.action = action.id;
}

async function teardown() {
  if (!ids.site) return;
  // Raw client: the guard would refuse these on a completed project.
  await raw.siteClosureEvent.deleteMany({ where: { jobSiteId: ids.site } });
  await raw.action.deleteMany({ where: { jobSiteId: ids.site } });
  await raw.workerSiteAssignment.deleteMany({ where: { jobSiteId: ids.site } });
  await raw.submission.deleteMany({ where: { jobSiteId: ids.site } });
  await raw.closeOutPack.deleteMany({ where: { jobSiteId: ids.site } });
  await raw.jobSite.deleteMany({ where: { id: ids.site } });
  if (ids.otherSite) {
    await raw.action.deleteMany({ where: { jobSiteId: ids.otherSite } });
    await raw.jobSite.deleteMany({ where: { id: ids.otherSite } });
  }
  if (ids.worker) await raw.worker.deleteMany({ where: { id: ids.worker } });
  if (ids.director)
    await raw.platformUser.deleteMany({ where: { id: ids.director } });
}

async function main() {
  console.log('== SC-025 project completion ==\n');
  await setup();

  const siteId = ids.site;
  const director = viewerFor('DIRECTOR', [siteId]);
  const siteManager = viewerFor('SITE_MANAGER', [siteId]);
  const engineer = viewerFor('ENGINEER', [siteId]);

  console.log('[1] Closure is BLOCKED while someone is checked in');
  let checklist = await buildClosureChecklist(siteId);
  check(
    'checklist reports the worker on site',
    checklist.blockers.some((b) => b.key === 'workers_on_site'),
    checklist.blockers.map((b) => b.key).join(', ') || 'no blockers',
  );
  check('canClose is false', checklist.canClose === false);
  let closed = await closeProject(director, siteId, {});
  check(
    'closeProject refuses',
    !closed.ok && closed.reason === 'blocked',
    closed.ok ? 'CLOSED ANYWAY — BAD' : closed.reason,
  );

  console.log('\n[2] Closure is BLOCKED while a permit is live');
  await raw.submission.update({
    where: { id: ids.submission },
    data: { checkedOutAt: new Date() },
  });
  const permitType = await raw.permitType.findFirst({
    select: { id: true, key: true, name: true },
  });
  if (permitType) {
    const permit = await raw.permit.create({
      data: {
        reference: `SC025-${SUFFIX}`,
        jobSiteId: siteId,
        workerId: ids.worker,
        permitTypeId: permitType.id,
        permitTypeKey: permitType.key,
        permitTypeName: permitType.name,
        status: 'APPROVED',
        workActivity: 'Test activity',
        answers: [],
        submittedByName: 'SC025 Worker',
      },
      select: { id: true },
    });
    ids.permit = permit.id;
    checklist = await buildClosureChecklist(siteId);
    check(
      'checklist reports the live permit',
      checklist.blockers.some((b) => b.key === 'active_permits'),
      checklist.blockers.map((b) => b.key).join(', ') || 'no blockers',
    );
    closed = await closeProject(director, siteId, {});
    check('closeProject still refuses', !closed.ok);
    await raw.permit.update({
      where: { id: permit.id },
      data: { status: 'CLOSED' },
    });
  } else {
    console.log('  SKIP  no PermitType seeded in this database');
  }

  console.log('\n[3] Permissions');
  const denied = await closeProject(engineer, siteId, {});
  check(
    'a role without the right cannot close',
    !denied.ok && denied.reason === 'forbidden',
    denied.ok ? 'ALLOWED — BAD' : denied.reason,
  );

  console.log('\n[4] Closing with overridable warnings');
  checklist = await buildClosureChecklist(siteId);
  check(
    'now closable',
    checklist.canClose === true,
    checklist.blockers.map((b) => b.key).join(','),
  );
  check(
    'the open action is a WARNING, not a blocker',
    checklist.warnings.some((w) => w.key === 'open_actions'),
    checklist.warnings.map((w) => w.key).join(', '),
  );
  check(
    'incidents are reported UNAVAILABLE, not passing',
    checklist.items.some(
      (i) => i.key === 'incidents' && i.severity === 'UNAVAILABLE',
    ),
  );
  // A Site Manager may close, per the approved decision.
  const smClose = await closeProject(siteManager, siteId, {
    reason: 'Practical completion reached.',
  });
  check(
    'a Site Manager can close the project',
    smClose.ok,
    smClose.ok ? `${smClose.warnings} warning(s) recorded` : smClose.reason,
  );

  const siteAfter = await raw.jobSite.findUniqueOrThrow({
    where: { id: siteId },
    select: { status: true, completedAt: true, completedByName: true },
  });
  check('status is COMPLETED', siteAfter.status === 'COMPLETED');
  check('completedAt recorded', siteAfter.completedAt !== null);
  check(
    'who closed it is recorded',
    siteAfter.completedByName === 'SC025 SITE_MANAGER',
    siteAfter.completedByName ?? 'null',
  );

  const events = await listClosureEvents(director, siteId);
  check('a closure event was written', !!events && events.length === 1);
  check(
    'the overridden warnings were snapshotted',
    !!events && events[0]!.warnings.some((w) => w.key === 'open_actions'),
    events ? JSON.stringify(events[0]!.warnings) : '',
  );

  console.log('\n[5] Worker access suspended, schedules stopped');
  const assignment = await raw.workerSiteAssignment.findUniqueOrThrow({
    where: { id: ids.assignment },
    select: { status: true },
  });
  check(
    'assignment SUSPENDED, not deleted',
    assignment.status === 'SUSPENDED',
    assignment.status,
  );
  check(
    'the assignment row still exists (history preserved)',
    (await raw.workerSiteAssignment.count({ where: { jobSiteId: siteId } })) ===
      1,
  );

  console.log('\n[6] The project is READ-ONLY');
  // Straight through the ordinary client, exactly as any unmodified service
  // would write — this is what the Prisma guard exists to catch.
  let blockedWrite = false;
  try {
    await prisma.action.update({
      where: { id: ids.action },
      data: { title: 'edited after closure' },
    });
  } catch (e) {
    blockedWrite = e instanceof ProjectClosedError;
  }
  check('updating an action is refused', blockedWrite);

  let blockedCreate = false;
  try {
    await prisma.action.create({
      data: {
        jobSiteId: siteId,
        title: 'new action after closure',
        description: 'should never be created',
        status: 'OPEN',
        priority: 'LOW',
        assignedTo: 'X',
        createdByName: 'X',
        dueDate: new Date(),
      },
    });
  } catch (e) {
    blockedCreate = e instanceof ProjectClosedError;
  }
  check('creating an action is refused', blockedCreate);

  let blockedDelete = false;
  try {
    await prisma.action.delete({ where: { id: ids.action } });
  } catch (e) {
    blockedDelete = e instanceof ProjectClosedError;
  }
  check('deleting a historical record is refused', blockedDelete);
  check(
    'the record survived the delete attempt',
    (await raw.action.count({ where: { id: ids.action } })) === 1,
  );

  let blockedBulk = false;
  try {
    await prisma.document.updateMany({
      where: { jobSiteId: siteId },
      data: { title: 'bulk edit' },
    });
  } catch (e) {
    blockedBulk = e instanceof ProjectClosedError;
  }
  check('a bulk update scoped to the project is refused', blockedBulk);

  console.log('\n[7] …but the close-out pack still works');
  let packOk = false;
  try {
    const pack = await prisma.closeOutPack.create({
      data: {
        jobSiteId: siteId,
        version: 1,
        title: 'Post-closure pack',
        sections: [{ section: 'site_details', order: 0 }],
        generatedByName: 'SC025 Director',
      },
      select: { id: true },
    });
    packOk = !!pack.id;
  } catch {
    packOk = false;
  }
  check('a close-out pack can be generated after closure', packOk);

  console.log('\n[8] Another project is unaffected');
  // A REAL write on a second, open project. A read would prove nothing: the
  // guard only intercepts writes, so reading successfully is not evidence that
  // writing still works.
  let otherOk = false;
  let otherErr = '';
  try {
    const created = await prisma.action.create({
      data: {
        jobSiteId: ids.otherSite,
        title: 'SC025 control action on an open project',
        description: 'Proves the guard is scoped to the completed project.',
        status: 'OPEN',
        priority: 'LOW',
        assignedTo: 'Someone',
        createdByName: 'SC025 Setup',
        dueDate: new Date(Date.now() + 86400_000),
      },
      select: { id: true },
    });
    await prisma.action.update({
      where: { id: created.id },
      data: { title: 'SC025 control action, edited' },
    });
    await prisma.action.delete({ where: { id: created.id } });
    otherOk = true;
  } catch (e) {
    otherErr = e instanceof Error ? e.message.slice(0, 80) : String(e);
  }
  check(
    'create/update/delete on a DIFFERENT project all still work',
    otherOk,
    otherErr,
  );

  console.log('\n[9] Reopening');
  const smReopen = await reopenProject(siteManager, siteId, { reason: 'x' });
  check(
    'a Site Manager cannot reopen',
    !smReopen.ok && smReopen.reason === 'forbidden',
    smReopen.ok ? 'ALLOWED — BAD' : smReopen.reason,
  );
  const noReason = await reopenProject(director, siteId, { reason: '   ' });
  check(
    'a reason is mandatory',
    !noReason.ok && noReason.reason === 'reason_required',
    noReason.ok ? 'ALLOWED — BAD' : noReason.reason,
  );
  const reopened = await reopenProject(director, siteId, {
    reason: 'Client raised a defect requiring records to be updated.',
  });
  check(
    'a Director can reopen',
    reopened.ok,
    reopened.ok
      ? `${reopened.restoredAssignments} assignment(s) restored`
      : reopened.reason,
  );
  check(
    'the suspended assignment was restored',
    (
      await raw.workerSiteAssignment.findUniqueOrThrow({
        where: { id: ids.assignment },
        select: { status: true },
      })
    ).status === 'ACTIVE',
  );

  let writeWorks = false;
  try {
    await prisma.action.update({
      where: { id: ids.action },
      data: { title: 'edited after reopening' },
    });
    writeWorks = true;
  } catch {
    writeWorks = false;
  }
  check('records are editable again', writeWorks);

  const finalEvents = await listClosureEvents(director, siteId);
  check(
    'both closure and reopening are in the audit trail',
    !!finalEvents &&
      finalEvents.length === 2 &&
      finalEvents[0]!.action === 'REOPENED',
    finalEvents ? finalEvents.map((e) => e.action).join(' <- ') : '',
  );
  check(
    'the reopening reason was recorded',
    !!finalEvents && !!finalEvents[0]!.reason,
    finalEvents?.[0]?.reason ?? 'none',
  );

  console.log(
    `\n== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ==`,
  );
}

main()
  .then(async () => {
    await teardown();
    await raw.$disconnect();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await teardown();
    await raw.$disconnect();
    await prisma.$disconnect();
    process.exit(1);
  });
