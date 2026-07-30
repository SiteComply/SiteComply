import { PrismaClient } from '@prisma/client';

/**
 * SC-020 Phase 1 migration verification.
 *
 * A standalone script rather than an inline `tsx -e` one-liner: the previous
 * items' inline SQL needed four levels of shell quote escaping, which is easy to
 * mangle and impossible to read. This checks the same things far more legibly.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('ComplianceSchedule', 'ComplianceOccurrence')`,
  );
  const enums = await prisma.$queryRawUnsafe<{ typname: string }[]>(
    `SELECT typname FROM pg_type
     WHERE typname IN ('ScheduleFrequency', 'ScheduleAssigneeKind', 'OccurrenceStatus')`,
  );
  // The idempotency guarantee for occurrence generation.
  const uniqueIndex = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'ComplianceOccurrence'
       AND indexname = 'ComplianceOccurrence_scheduleId_dueAt_key'`,
  );

  const templates = await prisma.auditTemplate.count({
    where: { isSystem: true },
  });
  const schedules = await prisma.complianceSchedule.count();
  const occurrences = await prisma.complianceOccurrence.count();

  // The REV-1 calendar's activity types must all be present as templates.
  const expected = [
    'Daily Safe Start',
    'Fire Point Check',
    'Scaffold Inspection',
    'MEWP Inspection',
    'Welfare Inspection',
    'Toolbox Talk',
  ];
  const found = await prisma.auditTemplate.findMany({
    where: { name: { in: expected } },
    select: { name: true },
  });
  const missing = expected.filter((n) => !found.some((f) => f.name === n));

  console.log('      new tables:', tables.length, 'of 2');
  console.log('      new enums:', enums.length, 'of 3');
  console.log('      idempotency unique index:', uniqueIndex.length, 'of 1');
  console.log('      system audit templates:', templates);
  console.log(
    '      REV-1 activity types present:',
    expected.length - missing.length,
    'of',
    expected.length,
    missing.length ? `(missing: ${missing.join(', ')})` : '',
  );
  console.log(
    '      schedules:',
    schedules,
    '| occurrences:',
    occurrences,
    '(expect 0 — no backfill)',
  );

  const ok =
    tables.length === 2 &&
    enums.length === 3 &&
    uniqueIndex.length === 1 &&
    missing.length === 0 &&
    schedules === 0 &&
    occurrences === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
