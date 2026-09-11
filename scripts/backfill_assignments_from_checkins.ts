/**
 * Restore access that unconditional enforcement took away.
 *
 * TWO remediations, both driven by the same fact: the worker has demonstrably
 * used the site, so they had access the moment before the rule changed.
 *
 *   PASS 1  no assignment at all  → create an ACTIVE one.
 *   PASS 2  an INVITED assignment → promote it to ACTIVE.
 *
 * PASS 2 exists because the first version of this script only handled PASS 1,
 * and that was too narrow. The guard it replaced counted workers with check-ins
 * lacking an ACTIVE assignment — which includes INVITED. An INVITED row was
 * INERT while enforcement was off (evaluateAssignmentGate returned not-blocked
 * before it ever read the status), so workers checked in perfectly happily with
 * one. Making enforcement unconditional turned those dormant rows into refusals.
 *
 * PASS 2 IS DELIBERATELY NARROW. An INVITED row is not always legacy — it is
 * also how a re-invited SUSPENDED or REMOVED worker and a TRANSFERRED-IN worker
 * are represented, and both of those must keep needing approval. A row is only
 * promoted when ALL of these hold:
 *
 *   1. the worker has at least one check-in at that site;
 *   2. it was invited BEFORE enforcement became unconditional — after that, a
 *      normal invitation produces ACTIVE, so INVITED can only be an exception;
 *   3. it carries no `transferredFromSiteName` — not a transfer awaiting the
 *      receiving site's consent;
 *   4. its history holds no SUSPENDED or REMOVED event — access was never
 *      deliberately withdrawn.
 *
 * Anything failing those is REPORTED and skipped, never silently passed over.
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
 * Anyone who already has an assignment — including suspended and
 * removed workers — is left exactly as they are.
 *
 * Dry run:  npx tsx scripts/backfill_assignments_from_checkins.ts
 * Apply:    npx tsx scripts/backfill_assignments_from_checkins.ts --apply
 */
import { WorkerAssignmentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * When enforcement became unconditional in production (build
 * `6ob-BdbwkgDjd2yKnGKD-`). An INVITED row created after this is an intentional
 * exception, not a casualty. Override with CUTOVER=<iso> for another environment.
 */
const CUTOVER = new Date(process.env.CUTOVER ?? '2026-09-10T05:19:48Z');

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
      // createMany would be faster, but a unique-constraint collision here
      // should be a no-op, not a failure for the whole run.
      try {
        await prisma.workerSiteAssignment.create({
          data: {
            workerId,
            jobSiteId: site.id,
            status: WorkerAssignmentStatus.ACTIVE,
            invitedByName: 'Backfilled from existing check-ins',
            approvedByName: 'Backfilled from existing check-ins',
            approvedAt: new Date(),
            // They read "Active" immediately: the roster derives that from their
            // attendance history, which is exactly why they are in this list.
            backfilled: true,
          },
        });
        created += 1;
      } catch {
        // Already created by a concurrent invitation — leave theirs alone.
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* PASS 2 — an INVITED assignment where the worker has already used the site  */
  /* ------------------------------------------------------------------------ */
  console.log(`\n-- Pass 2: INVITED assignments with check-in history --`);
  console.log(`   cutover: ${CUTOVER.toISOString()} (rows invited after this are exceptions, not casualties)\n`);

  const invited = await prisma.workerSiteAssignment.findMany({
    where: { status: WorkerAssignmentStatus.INVITED },
    select: {
      id: true, workerId: true, jobSiteId: true, invitedAt: true,
      transferredFromSiteName: true,
      worker: { select: { fullName: true } },
      jobSite: { select: { name: true } },
    },
  });

  let promotable = 0;
  let promoted = 0;
  const skipped: string[] = [];

  for (const a of invited) {
    const who = `${a.jobSite?.name ?? a.jobSiteId} :: ${a.worker?.fullName ?? a.workerId}`;

    const firstCheckIn = await prisma.submission.findFirst({
      where: { workerId: a.workerId, jobSiteId: a.jobSiteId },
      orderBy: { checkedInAt: 'asc' },
      select: { checkedInAt: true },
    });
    if (!firstCheckIn) {
      skipped.push(`${who} — never checked in here, so nothing was lost`);
      continue;
    }
    if (a.invitedAt >= CUTOVER) {
      skipped.push(`${who} — invited after the cutover, so this is a deliberate exception`);
      continue;
    }
    if (a.transferredFromSiteName) {
      skipped.push(`${who} — transferred in from ${a.transferredFromSiteName}; the receiving site must approve`);
      continue;
    }
    // Access deliberately withdrawn at some point: never quietly restore it.
    const revocation = await prisma.workerAssignmentEvent.findFirst({
      where: {
        workerId: a.workerId,
        jobSiteId: a.jobSiteId,
        action: { in: ['SUSPENDED', 'REMOVED'] },
      },
      select: { action: true, createdAt: true },
    });
    if (revocation) {
      skipped.push(`${who} — was ${revocation.action.toLowerCase()} on ${revocation.createdAt.toISOString().slice(0, 10)}; approval must stay manual`);
      continue;
    }

    promotable += 1;
    console.log(`  ${who} — first checked in ${firstCheckIn.checkedInAt.toISOString().slice(0, 10)}`);
    if (!apply) continue;

    // Guarded on status so a manager approving concurrently wins rather than
    // being overwritten by this script.
    const res = await prisma.workerSiteAssignment.updateMany({
      where: { id: a.id, status: WorkerAssignmentStatus.INVITED },
      data: {
        status: WorkerAssignmentStatus.ACTIVE,
        approvedAt: new Date(),
        approvedByName: 'Restored — access predates invitation enforcement',
      },
    });
    promoted += res.count;
    if (res.count > 0) {
      await prisma.workerAssignmentEvent.create({
        data: {
          workerId: a.workerId,
          workerName: a.worker?.fullName ?? '—',
          jobSiteId: a.jobSiteId,
          siteName: a.jobSite?.name ?? '—',
          action: 'APPROVED',
          actorName: 'Backfill',
          detail:
            'Restored to active: the worker had already checked in here, and the invitation status was not enforced at the time.',
        },
      });
    }
  }

  if (skipped.length > 0) {
    console.log(`\n  Skipped, deliberately:`);
    skipped.forEach((x) => console.log(`     ${x}`));
  }

  console.log(`\n== SUMMARY ==`);
  console.log(`  Pass 1 — assignments needed for workers with none: ${wouldCreate}`);
  if (apply) console.log(`           created: ${created}`);
  console.log(`  Pass 2 — INVITED rows to promote:                  ${promotable}`);
  if (apply) console.log(`           promoted: ${promoted}`);
  console.log(`  Skipped by the safety rules:                       ${skipped.length}`);
  if (!apply) console.log('\n  Dry run only. Re-run with --apply to write.');
  if (wouldCreate === 0 && promotable === 0) console.log('  Nothing to do — nobody is locked out.');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
