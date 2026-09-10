/**
 * Give an ACTIVE assignment to anyone who already checks in to a site but has
 * none.
 *
 * Enforcement used to be a per-site switch, and switching it ON was REFUSED
 * while anyone was in this position: "N workers have checked in here but are not
 * approved. Invite or approve them first, or they will be turned away at the
 * gate." Enforcement is now unconditional, so that guard has no moment to run in
 * — this script carries its job instead, and must be run once.
 *
 * Without it, a worker who has been checking in for months is refused at the
 * gate with "You have not been invited to this project", and nobody is warned.
 *
 * Safe to re-run: only workers with NO assignment for that site are given one,
 * and `acceptedAt` is set from their first check-in so they read Active, not
 * Invited. Anyone who already has an assignment — including suspended and
 * removed workers — is left exactly as they are.
 *
 * Dry run:  npx tsx scripts/backfill_assignments_from_checkins.ts
 * Apply:    npx tsx scripts/backfill_assignments_from_checkins.ts --apply
 */
import { WorkerAssignmentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`== ASSIGNMENT BACKFILL ${apply ? '(APPLYING)' : '(DRY RUN)'} ==\n`);

  const sites = await prisma.jobSite.findMany({ select: { id: true, name: true } });
  let wouldCreate = 0;
  let created = 0;

  for (const site of sites) {
    const seen = await prisma.submission.findMany({
      where: { jobSiteId: site.id },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    if (seen.length === 0) continue;

    const existing = await prisma.workerSiteAssignment.findMany({
      where: { jobSiteId: site.id, workerId: { in: seen.map((s) => s.workerId) } },
      select: { workerId: true },
    });
    const have = new Set(existing.map((e) => e.workerId));
    const missing = seen.map((s) => s.workerId).filter((id) => !have.has(id));
    if (missing.length === 0) continue;

    const names = await prisma.worker.findMany({
      where: { id: { in: missing } },
      select: { id: true, fullName: true },
    });
    console.log(`  ${site.name}: ${missing.length} worker(s) with check-ins but no assignment`);
    for (const w of names) console.log(`      ${w.fullName}`);
    wouldCreate += missing.length;

    if (!apply) continue;

    for (const workerId of missing) {
      const first = await prisma.submission.findFirst({
        where: { workerId, jobSiteId: site.id },
        orderBy: { checkedInAt: 'asc' },
        select: { checkedInAt: true },
      });
      // createMany would be faster, but each row needs its own acceptedAt and a
      // unique-constraint collision here should be a no-op, not a failure.
      try {
        await prisma.workerSiteAssignment.create({
          data: {
            workerId,
            jobSiteId: site.id,
            status: WorkerAssignmentStatus.ACTIVE,
            invitedByName: 'Backfilled from existing check-ins',
            approvedByName: 'Backfilled from existing check-ins',
            approvedAt: new Date(),
            acceptedAt: first?.checkedInAt ?? new Date(),
            backfilled: true,
          },
        });
        created += 1;
      } catch {
        // Already created by a concurrent invitation — leave theirs alone.
      }
    }
  }

  console.log(`\n  ${wouldCreate} assignment(s) needed`);
  if (apply) console.log(`  ${created} created`);
  else console.log('\n  Dry run only. Re-run with --apply to write.');
  if (wouldCreate === 0) console.log('  Nothing to do — nobody would be locked out.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
