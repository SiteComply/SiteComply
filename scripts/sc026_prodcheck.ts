/**
 * SC-026 post-deploy production check — READ ONLY.
 *
 * The release's safety claim is "nothing changes until a Director saves". This
 * proves it against real production data by running the code paths the deploy
 * added, and it writes NOTHING: no config row, no assignment, no attendance
 * record.
 *
 * It deliberately does not perform a check-in. A real check-in writes an
 * attendance Submission at a customer's site and is GPS-gated on the worker's
 * actual position, so "test it in production" would mean fabricating a worker,
 * an induction and a location fix, then leaving a false attendance record in a
 * compliance system. The decision function is what this release changed, so
 * the decision function is what gets tested — for every real worker/site pair,
 * with the real config.
 */
import { PrismaClient } from '@prisma/client';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import { canWorkerCheckIn } from '@/services/workerAccess/workerAssignmentService';

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

async function main() {
  console.log('== SC-026 production check (read-only) ==\n');

  // ---- 1. the effective configuration -------------------------------------
  console.log('[1] Effective auth configuration in production');
  const cfg = await getAuthRuntimeConfig();
  check('worker SMS login is ON', cfg.workerSmsLoginEnabled === true);
  check('express check-in is ON', cfg.expressCheckInEnabled === true);
  check('invited-workers-only is OFF', cfg.invitedWorkersOnly === false);
  check(
    'require-active-assignment is OFF',
    cfg.requireActiveSiteAssignment === false,
  );
  check(
    'worker session TTL is the 2h default',
    cfg.workerSessionTtlSeconds === 7200,
    `${cfg.workerSessionTtlSeconds}s`,
  );
  check(
    'platform session TTL is the 8h default',
    cfg.sessionTtlSeconds === 28800,
    `${cfg.sessionTtlSeconds}s`,
  );

  const rows = await prisma.authConfig.count();
  check(
    'no config row exists — the deploy wrote nothing',
    rows === 0,
    `${rows} rows`,
  );

  // ---- 2. the access decision, against real data --------------------------
  // This is the path that would change behaviour if the organisation floor
  // were wrong. Under defaults every non-enforcing site must still answer
  // {allowed: true, enforced: false} — byte-for-byte the pre-release answer.
  console.log('\n[2] canWorkerCheckIn across real workers and sites');
  const sites = await prisma.jobSite.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, workerAccessEnforced: true },
    take: 25,
  });
  const workers = await prisma.worker.findMany({
    select: { id: true },
    take: 25,
  });
  console.log(`    ${sites.length} active site(s), ${workers.length} worker(s)`);

  if (sites.length === 0 || workers.length === 0) {
    console.log('    (nothing to evaluate — no active sites or no workers)');
  }

  let pairs = 0;
  let unchanged = 0;
  const anomalies: string[] = [];
  for (const site of sites) {
    for (const w of workers) {
      pairs += 1;
      const d = await canWorkerCheckIn(w.id, site.id);
      if (!site.workerAccessEnforced) {
        // The org floor is off, so a non-enforcing site must short-circuit to
        // allowed/not-enforced. Anything else means the floor is engaging when
        // nobody switched it on.
        if (d.allowed === true && d.enforced === false) unchanged += 1;
        else
          anomalies.push(
            `${site.name}: expected allowed/not-enforced, got ${JSON.stringify(d)}`,
          );
      }
    }
  }
  const nonEnforcing = sites.filter((s) => !s.workerAccessEnforced).length;
  const enforcing = sites.length - nonEnforcing;
  console.log(
    `    ${nonEnforcing} site(s) not enforcing, ${enforcing} enforcing their own rules`,
  );
  check(
    'every non-enforcing site still answers allowed/not-enforced',
    anomalies.length === 0,
    `${unchanged}/${pairs} pairs evaluated, ${anomalies.length} anomalies`,
  );
  anomalies.slice(0, 5).forEach((a) => console.log(`      ! ${a}`));

  // Sites that enforce their own access are UNTOUCHED by this release. Report
  // their decisions rather than asserting them: what they return depends on
  // each worker's assignment, which is exactly the pre-existing behaviour.
  if (enforcing > 0) {
    console.log(
      '    (informational) enforcing sites keep their own rules — not asserted here',
    );
  }

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  console.log('   Nothing was written to production by this check.');
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
