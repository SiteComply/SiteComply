import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const dupes = await prisma.worker.groupBy({
    by: ['fullName'], _count: { _all: true }, having: { fullName: { _count: { gt: 1 } } },
  });
  console.log('worker names shared by more than one record:');
  for (const d of dupes) console.log(`  "${d.fullName}" × ${d._count._all} (distinct mobiles)`);
  const pairs = await prisma.submission.findMany({
    select: { workerId: true, jobSiteId: true }, distinct: ['workerId', 'jobSiteId'],
  });
  const assigns = await prisma.workerSiteAssignment.count();
  const dupAssign = await prisma.workerSiteAssignment.groupBy({
    by: ['workerId', 'jobSiteId'], _count: { _all: true },
    having: { workerId: { _count: { gt: 1 } } },
  });
  console.log(`\npairs with history: ${pairs.length} · assignments: ${assigns} · duplicate assignments: ${dupAssign.length}`);
  console.log(assigns === pairs.length && dupAssign.length === 0
    ? 'Backfill is exact: one assignment per pair, no duplicates.'
    : '*** MISMATCH ***');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
