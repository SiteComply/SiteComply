/**
 * Backfill WorkerSiteAssignment.acceptedAt from the worker's FIRST check-in.
 *
 * Why it is needed: acceptedAt drives the Invited → Active label, and nothing
 * ever wrote it before the check-in hook shipped. Until this runs, a worker who
 * has been on site for months reads "Invited", and the rail can show "On site
 * now" and "Invited" at the same time — visibly contradictory.
 *
 * Safe to re-run: only rows where acceptedAt IS NULL are touched, and each is set
 * from that worker's earliest Submission on that site. Rows with no check-in are
 * left alone — they genuinely have not arrived yet.
 *
 * Dry run:  npx tsx scripts/backfill_assignment_acceptance.ts
 * Apply:    npx tsx scripts/backfill_assignment_acceptance.ts --apply
 */
import { prisma } from '../lib/prisma';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`== ACCEPTANCE BACKFILL ${apply ? '(APPLYING)' : '(DRY RUN)'} ==\n`);

  const pending = await prisma.workerSiteAssignment.findMany({
    where: { acceptedAt: null },
    select: { id: true, workerId: true, jobSiteId: true, status: true },
  });
  console.log(`  ${pending.length} assignment(s) with no acceptance recorded`);

  let matched = 0;
  let updated = 0;
  for (const a of pending) {
    const first = await prisma.submission.findFirst({
      where: { workerId: a.workerId, jobSiteId: a.jobSiteId },
      orderBy: { checkedInAt: 'asc' },
      select: { checkedInAt: true },
    });
    if (!first?.checkedInAt) continue;
    matched += 1;
    if (apply) {
      // Guard on acceptedAt again so a concurrent real check-in wins rather than
      // being overwritten by a historic timestamp.
      const res = await prisma.workerSiteAssignment.updateMany({
        where: { id: a.id, acceptedAt: null },
        data: { acceptedAt: first.checkedInAt },
      });
      updated += res.count;
    }
  }

  console.log(`  ${matched} of those have a check-in to backfill from`);
  console.log(`  ${pending.length - matched} have never checked in — correctly left as Invited`);
  if (apply) console.log(`  ${updated} row(s) updated`);
  else console.log('\n  Dry run only. Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
