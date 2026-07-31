import { PrismaClient } from '@prisma/client';

/** SC-023 read-only production state: enforcement, assignments, access history. */
const prisma = new PrismaClient();

async function main() {
  const sites = await prisma.jobSite.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      workerAccessEnforced: true,
      _count: { select: { workerAssignments: true } },
    },
    orderBy: { name: 'asc' },
  });
  const byStatus = await prisma.workerSiteAssignment.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const events = await prisma.workerAssignmentEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const open = await prisma.submission.count({ where: { checkedOutAt: null } });

  console.log('active sites:');
  for (const s of sites) {
    console.log(
      `  ${s.name} · controlled access ${s.workerAccessEnforced ? 'ON' : 'off'} · ${s._count.workerAssignments} assignment(s)`,
    );
  }
  console.log('\nassignments by status:');
  if (byStatus.length === 0) console.log('  (none — backfill not yet run)');
  for (const b of byStatus) console.log(`  ${b.status}: ${b._count._all}`);

  console.log(`\nworkers currently on site: ${open}`);
  console.log(`\nrecent access events (${events.length}):`);
  for (const e of events) {
    console.log(
      `  ${e.createdAt.toISOString()} ${e.action} · ${e.workerName} @ ${e.siteName} · by ${e.actorName}`,
    );
  }
  const enforced = sites.filter((s) => s.workerAccessEnforced).length;
  if (enforced === 0) {
    console.log(
      '\nNo site enforces controlled access — check-in behaves exactly as before SC-023.',
    );
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
