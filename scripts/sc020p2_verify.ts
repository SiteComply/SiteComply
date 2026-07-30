import { PrismaClient } from '@prisma/client';

/** SC-020 Phase 2 migration verification — escalation state + event type. */
const prisma = new PrismaClient();

async function main() {
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ComplianceOccurrence'
       AND column_name IN ('escalatedAt', 'escalatedToRole')`,
  );
  const enumValues = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NotificationEventType'
       AND e.enumlabel = 'COMPLIANCE_ESCALATED'`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'ComplianceOccurrence'
       AND indexname = 'ComplianceOccurrence_escalatedAt_status_idx'`,
  );
  const escalated = await prisma.complianceOccurrence.count({
    where: { escalatedAt: { not: null } },
  });
  const events = await prisma.notificationEvent.count({
    where: { type: 'COMPLIANCE_ESCALATED' },
  });

  console.log('      escalation columns:', cols.length, 'of 2');
  console.log('      COMPLIANCE_ESCALATED enum value:', enumValues.length, 'of 1');
  console.log('      escalation index:', idx.length, 'of 1');
  console.log(
    '      already-escalated occurrences:',
    escalated,
    '| escalation events:',
    events,
    '(expect 0 — no backfill)',
  );

  const ok =
    cols.length === 2 &&
    enumValues.length === 1 &&
    idx.length === 1 &&
    escalated === 0 &&
    events === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
