import { PrismaClient } from '@prisma/client';

/**
 * SC-023 backfill — grandfather existing workers onto the sites they already use.
 *
 * Deliberately a SEPARATE, explicit step rather than part of the migration, so
 * it can be inspected (and re-run) before enforcement is switched on anywhere.
 *
 * Every distinct (worker, site) pair that has EVER checked in becomes an ACTIVE
 * assignment marked `backfilled`. Without this, switching enforcement on would
 * turn away every existing worker — the platform has 17 of them and several are
 * on site right now.
 *
 * Idempotent: skips pairs that already have an assignment, so a real invitation
 * is never overwritten by a backfill.
 *
 * Pass --apply to write; the default is a dry run.
 */
const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  const pairs = await prisma.submission.findMany({
    select: { workerId: true, jobSiteId: true },
    distinct: ['workerId', 'jobSiteId'],
  });
  const existing = await prisma.workerSiteAssignment.findMany({
    select: { workerId: true, jobSiteId: true },
  });
  const have = new Set(existing.map((e) => `${e.workerId}:${e.jobSiteId}`));
  const missing = pairs.filter(
    (p) => !have.has(`${p.workerId}:${p.jobSiteId}`),
  );

  console.log(
    `distinct (worker, site) pairs with check-in history: ${pairs.length}`,
  );
  console.log(`already assigned: ${pairs.length - missing.length}`);
  console.log(`to backfill: ${missing.length}`);

  if (!apply) {
    console.log(
      '\nDRY RUN — nothing written. Re-run with --apply to create them.',
    );
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const p of missing) {
    const [worker, site] = await Promise.all([
      prisma.worker.findUnique({
        where: { id: p.workerId },
        select: { fullName: true },
      }),
      prisma.jobSite.findUnique({
        where: { id: p.jobSiteId },
        select: { name: true },
      }),
    ]);
    if (!worker || !site) continue;

    await prisma.workerSiteAssignment.create({
      data: {
        workerId: p.workerId,
        jobSiteId: p.jobSiteId,
        status: 'ACTIVE',
        backfilled: true,
        invitedByName: 'SiteComply (backfill)',
        approvedByName: 'SiteComply (backfill)',
        approvedAt: new Date(),
      },
    });
    // Recorded in the audit trail like any other access grant: "how did this
    // person get access?" must stay answerable, including for grandfathered
    // workers who were never actually invited.
    await prisma.workerAssignmentEvent.create({
      data: {
        workerId: p.workerId,
        workerName: worker.fullName,
        jobSiteId: p.jobSiteId,
        siteName: site.name,
        action: 'BACKFILLED',
        actorName: 'SiteComply (backfill)',
        detail:
          'Granted from existing check-in history when SC-023 was introduced.',
      },
    });
    created++;
  }

  console.log(`\ncreated: ${created}`);
  const openNow = await prisma.submission.count({
    where: { checkedOutAt: null },
  });
  console.log(
    `workers currently checked in (must not be disrupted): ${openNow}`,
  );
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
