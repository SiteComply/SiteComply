/**
 * SC-020 FOLLOW-UP — deleting an audit must not leave a ghost on the calendar.
 *
 * Exercises the real services against the real database: schedule an activity,
 * start it (which creates an audit), delete that audit, and check what the
 * CALENDAR would then show — not what the tables happen to contain.
 *
 * Cleans up everything it creates, and reports what is left behind.
 */
import { prisma } from '@/lib/prisma';
import { OccurrenceStatus } from '@prisma/client';
import { deleteAudit } from '@/services/audits/auditService';
import {
  getCalendarWindow,
  startOccurrence,
} from '@/services/compliance/occurrenceService';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const site = await prisma.jobSite.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (!site) throw new Error('no active site');
  const template = await prisma.auditTemplate.findFirst({
    where: { active: true },
    select: { id: true, name: true },
  });
  if (!template) throw new Error('no audit template');
  const user = await prisma.platformUser.findFirst({
    where: { role: 'DIRECTOR' },
    select: { id: true, name: true, role: true },
  });
  if (!user) throw new Error('no director');

  const viewer = {
    id: user.id,
    name: user.name,
    role: user.role,
    siteIds: [site.id],
    allSites: true,
  } as unknown as PlatformViewer;

  const dueDateLocal = '2099-06-15'; // far future: cannot collide with real data
  const schedule = await prisma.complianceSchedule.create({
    data: {
      jobSiteId: site.id,
      auditTemplateId: template.id,
      title: 'SC020FOLLOWUP fixture',
      frequency: 'MONTHLY',
      timeOfDay: '09:00',
      assigneeKind: 'ROLE',
      assignedRole: 'DIRECTOR',
      active: true,
      activatedAt: new Date(),
      startDate: new Date('2099-06-01T00:00:00Z'),
      reminderOffsetsDays: [],
    },
  });
  const occurrence = await prisma.complianceOccurrence.create({
    data: {
      scheduleId: schedule.id,
      jobSiteId: site.id,
      dueAt: new Date('2099-06-15T08:00:00Z'),
      dueDateLocal,
      timeOfDay: '09:00',
      assigneeKind: 'ROLE',
      assignedRole: 'DIRECTOR',
      assigneeLabel: 'Director',
      status: OccurrenceStatus.SCHEDULED,
    },
  });

  const onCalendar = async () => {
    const { occurrences } = await getCalendarWindow(
      viewer,
      dueDateLocal,
      dueDateLocal,
      site.id,
    );
    return occurrences.find((o) => o.id === occurrence.id) ?? null;
  };

  console.log('== before starting ==');
  const before = await onCalendar();
  check('the activity is on the calendar', Boolean(before));
  check('and is SCHEDULED', before?.status === OccurrenceStatus.SCHEDULED, String(before?.status));

  console.log('\n== start it: an audit is created ==');
  const started = await startOccurrence(viewer, occurrence.id);
  const auditId = started.ok ? started.auditId : undefined;
  check('starting created an audit', Boolean(auditId), auditId ?? 'none');
  const running = await onCalendar();
  check('the calendar now shows it IN_PROGRESS', running?.status === OccurrenceStatus.IN_PROGRESS, String(running?.status));
  check('and links to the audit', running?.auditId === auditId);

  console.log('\n== delete that audit ==');
  const deleted = await deleteAudit(viewer, auditId!);
  check('the audit was deleted', deleted);
  check(
    'the audit really is gone',
    (await prisma.audit.findUnique({ where: { id: auditId! } })) === null,
  );

  console.log('\n== what the calendar shows now (the reported bug) ==');
  const after = await onCalendar();
  check('the activity is still on the calendar', Boolean(after), 'the schedule still says it is due');
  check(
    'it is back to SCHEDULED, not a ghost IN_PROGRESS',
    after?.status === OccurrenceStatus.SCHEDULED,
    String(after?.status),
  );
  check('it no longer links to a deleted audit', after?.auditId === null, String(after?.auditId));
  check('it can be started again', (await startOccurrence(viewer, occurrence.id)).ok);

  // cleanup — including the audit the restart just created
  const fresh = await prisma.complianceOccurrence.findUnique({
    where: { id: occurrence.id },
    select: { auditId: true },
  });
  await prisma.complianceOccurrence.deleteMany({ where: { scheduleId: schedule.id } });
  await prisma.complianceSchedule.delete({ where: { id: schedule.id } });
  if (fresh?.auditId) await prisma.audit.delete({ where: { id: fresh.auditId } }).catch(() => {});
  console.log('\ncleanup: fixture schedule, occurrences and audit removed');
  console.log(`  schedules named SC020FOLLOWUP left: ${await prisma.complianceSchedule.count({ where: { title: { startsWith: 'SC020FOLLOWUP' } } })}`);

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
