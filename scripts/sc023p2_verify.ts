import { PrismaClient } from '@prisma/client';

/**
 * SC-023 Phase 2 migration verification.
 *
 * Every new field is null-means-unrestricted, so the assertion that matters is
 * that NOTHING WAS SET: no roles, no dates, no per-worker panel overrides. Any
 * value here would mean the migration had changed how a real worker's access
 * behaves, which this phase explicitly does not do.
 *
 * Enforcement is re-checked too — Phase 2 must not have switched it on anywhere.
 */
const prisma = new PrismaClient();

async function main() {
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'WorkerSiteAssignment'
       AND column_name IN ('role','startDate','endDate','transferredFromSiteName')`,
  );
  const enumType = await prisma.$queryRawUnsafe<{ typname: string }[]>(
    `SELECT typname FROM pg_type WHERE typname = 'WorkerSiteRole'`,
  );
  const tbl = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'WorkerPanelSetting'`,
  );

  const withRole = await prisma.workerSiteAssignment.count({ where: { role: { not: null } } });
  const withDates = await prisma.workerSiteAssignment.count({
    where: { OR: [{ startDate: { not: null } }, { endDate: { not: null } }] },
  });
  const panelOverrides = await prisma.workerPanelSetting.count();
  const enforced = await prisma.jobSite.count({ where: { workerAccessEnforced: true } });
  const assignments = await prisma.workerSiteAssignment.count();

  console.log('      new columns:', cols.length, 'of 4');
  console.log('      WorkerSiteRole enum:', enumType.length, 'of 1');
  console.log('      WorkerPanelSetting table:', tbl.length, 'of 1');
  console.log('      assignments with a role set:', withRole, '(expect 0)');
  console.log('      assignments with dates set:', withDates, '(expect 0)');
  console.log('      per-worker panel overrides:', panelOverrides, '(expect 0)');
  console.log('      sites enforcing access:', enforced, '(expect 0)');
  console.log('      total assignments:', assignments);

  const ok =
    cols.length === 4 && enumType.length === 1 && tbl.length === 1 &&
    withRole === 0 && withDates === 0 && panelOverrides === 0 && enforced === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
