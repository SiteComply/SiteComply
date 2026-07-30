import { PrismaClient } from '@prisma/client';

/**
 * SC-020 Phase 4 — read-only production status for the scheduler.
 *
 * Reports schedules, occurrence spread and the SchedulerRun history so the
 * timer can be verified without guessing. Writes nothing.
 */
const prisma = new PrismaClient();

async function main() {
  const schedules = await prisma.complianceSchedule.findMany({
    include: {
      jobSite: { select: { name: true, status: true } },
      auditTemplate: { select: { name: true } },
      _count: { select: { occurrences: true } },
    },
  });

  console.log(`SCHEDULES (${schedules.length}):`);
  for (const s of schedules) {
    console.log(
      `  "${s.title || s.auditTemplate.name}" site="${s.jobSite.name}" (${s.jobSite.status})` +
        ` freq=${s.frequency} weekdays=[${s.weekdays.join(',')}] time=${s.timeOfDay}` +
        ` active=${s.active} activatedAt=${s.activatedAt?.toISOString().slice(0, 10) ?? 'null'}` +
        ` startDate=${s.startDate} endDate=${s.endDate ?? 'none'} occurrences=${s._count.occurrences}`,
    );
  }

  const agg = await prisma.complianceOccurrence.aggregate({
    _min: { dueDateLocal: true },
    _max: { dueDateLocal: true },
    _count: true,
  });
  console.log(
    `\nOCCURRENCES: ${agg._count} total, earliest=${agg._min.dueDateLocal ?? '—'}, latest=${agg._max.dueDateLocal ?? '—'}`,
  );

  const runs = await prisma.schedulerRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 10,
  });
  console.log(`\nSCHEDULER RUNS (newest ${runs.length}):`);
  for (const r of runs) {
    console.log(
      `  ${r.startedAt.toISOString()} trigger=${r.trigger} ok=${r.ok}` +
        ` sites=${r.sitesConsidered} created=${r.occurrencesCreated}` +
        ` escalated=${r.escalationsRecorded}` +
        ` finished=${r.finishedAt ? 'yes' : 'NO'}${r.error ? ` error="${r.error}"` : ''}`,
    );
  }

  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
