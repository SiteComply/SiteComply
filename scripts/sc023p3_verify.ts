import { PrismaClient } from '@prisma/client';

/**
 * SC-023 Phase 3 migration verification.
 *
 * TWO independent switches must both be on before any worker can be refused for
 * a competency reason: the site enforcement switch (Phase 1) and the
 * requirement itself. This asserts BOTH are off everywhere — a requirement
 * enabled by the migration would mean workers could be turned away at the gate
 * tomorrow for a card problem nobody chose to enforce.
 *
 * It also reports how many workers WOULD fail the CSCS checks, so the decision
 * to enable them is made from evidence.
 */
const prisma = new PrismaClient();

async function main() {
  const tbl = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'SiteAccessRequirement'`,
  );
  const enumType = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'AccessRequirement'`,
  );

  const requirements = await prisma.siteAccessRequirement.count();
  const enabled = await prisma.siteAccessRequirement.count({ where: { enabled: true } });
  const enforcedSites = await prisma.jobSite.count({ where: { workerAccessEnforced: true } });

  const workers = await prisma.worker.count();
  const unverified = await prisma.worker.count({ where: { cscsVerified: false } });
  const noExpiry = await prisma.worker.count({
    where: { cscsVerified: true, cscsExpiry: null },
  });
  const expired = await prisma.worker.count({
    where: { cscsExpiry: { not: null, lt: new Date() } },
  });

  console.log('      SiteAccessRequirement table:', tbl.length, 'of 1');
  console.log('      AccessRequirement enum values:', enumType.length, 'of 5');
  console.log('      requirement rows:', requirements, '(expect 0)');
  console.log('      requirements ENABLED:', enabled, '(expect 0)');
  console.log('      sites enforcing access:', enforcedSites, '(expect 0)');
  console.log('');
  console.log('      IF CSCS_VERIFIED were enabled today:', unverified, 'of', workers, 'workers would fail');
  console.log('      IF CSCS_IN_DATE were enabled today:', noExpiry + expired, 'would fail',
    `(${expired} expired, ${noExpiry} with no expiry recorded)`);

  const ok =
    tbl.length === 1 && enumType.length === 5 &&
    requirements === 0 && enabled === 0 && enforcedSites === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
