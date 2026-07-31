import { PrismaClient } from '@prisma/client';

/**
 * SC-023 Phase 1 migration verification.
 *
 * The critical assertion is that NO SITE HAS ENFORCEMENT ENABLED. This migration
 * adds the ability to deny site access; it must not start denying it. A single
 * enforced site here would mean workers could be turned away at the gate
 * tomorrow morning without anyone having chosen that.
 *
 * It also reports how many workers WOULD be locked out if enforcement were
 * switched on today, so the backfill is run from evidence rather than hope.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('WorkerSiteAssignment', 'WorkerAssignmentEvent')`,
  );
  const enumType = await prisma.$queryRawUnsafe<{ typname: string }[]>(
    `SELECT typname FROM pg_type WHERE typname = 'WorkerAssignmentStatus'`,
  );
  const col = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'JobSite' AND column_name = 'workerAccessEnforced'`,
  );
  const eventFks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text = '"WorkerAssignmentEvent"'`,
  );

  const enforced = await prisma.jobSite.count({
    where: { workerAccessEnforced: true },
  });
  const assignments = await prisma.workerSiteAssignment.count();
  const openCheckIns = await prisma.submission.count({
    where: { checkedOutAt: null },
  });
  const pairs = await prisma.submission.findMany({
    select: { workerId: true, jobSiteId: true },
    distinct: ['workerId', 'jobSiteId'],
  });

  console.log('      tables:', tables.length, 'of 2');
  console.log('      status enum:', enumType.length, 'of 1');
  console.log('      workerAccessEnforced column:', col.length, 'of 1');
  console.log(
    '      event-log FKs:',
    eventFks.length,
    '(expect 0 — trail must outlive worker and site)',
  );
  console.log('      sites with enforcement ON:', enforced, '(expect 0)');
  console.log('      assignments:', assignments, '(expect 0 — backfill is a separate step)');
  console.log('      workers currently on site (must be undisturbed):', openCheckIns);
  console.log('      (worker, site) pairs the backfill will cover:', pairs.length);

  const ok =
    tables.length === 2 &&
    enumType.length === 1 &&
    col.length === 1 &&
    eventFks.length === 0 &&
    enforced === 0;
  if (enforced > 0) {
    console.log('      *** A SITE HAS ENFORCEMENT ON — workers may be denied access ***');
  }
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
