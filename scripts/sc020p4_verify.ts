import { PrismaClient } from '@prisma/client';

/** SC-020 Phase 4 migration verification — SchedulerRun table + trigger enum. */
const prisma = new PrismaClient();

async function main() {
  const tbl = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'SchedulerRun'`,
  );
  const en = await prisma.$queryRawUnsafe<{ typname: string }[]>(
    `SELECT typname FROM pg_type WHERE typname = 'SchedulerTrigger'`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'SchedulerRun'
       AND indexname = 'SchedulerRun_trigger_startedAt_idx'`,
  );
  const runs = await prisma.schedulerRun.count();

  console.log('      SchedulerRun table:', tbl.length, 'of 1');
  console.log('      SchedulerTrigger enum:', en.length, 'of 1');
  console.log('      index:', idx.length, 'of 1');
  console.log('      runs recorded:', runs, '(expect 0 — no backfill)');

  const ok = tbl.length === 1 && en.length === 1 && idx.length === 1 && runs === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
