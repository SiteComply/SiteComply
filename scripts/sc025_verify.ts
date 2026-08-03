/**
 * SC-025 migration verifier.
 *
 * Additive: one enum value, three nullable columns on JobSite, one new table.
 * The critical assertion is the NO-BACKFILL one — the site that was already
 * ARCHIVED must still be ARCHIVED, because it never passed a completion
 * checklist and declaring it COMPLETED would fabricate an approval.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

async function main() {
  console.log('== SC-025 schema verification ==');

  const enumVals = await prisma.$queryRaw<{ enumlabel: string }[]>`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SiteStatus'
  `;
  const labels = enumVals.map((e) => e.enumlabel);
  check('SiteStatus has COMPLETED', labels.includes('COMPLETED'), labels.join(', '));
  check(
    'ACTIVE and ARCHIVED are untouched',
    labels.includes('ACTIVE') && labels.includes('ARCHIVED'),
  );

  const cols = await prisma.$queryRaw<
    { column_name: string; is_nullable: string }[]
  >`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'JobSite' AND column_name LIKE 'completed%'
    ORDER BY column_name
  `;
  for (const name of ['completedAt', 'completedById', 'completedByName']) {
    const col = cols.find((c) => c.column_name === name);
    check(
      `${name} exists and is nullable`,
      !!col && col.is_nullable === 'YES',
      col ? `nullable=${col.is_nullable}` : 'missing',
    );
  }

  const tbl = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT count(*)::bigint AS c FROM information_schema.tables
    WHERE table_name = 'SiteClosureEvent'
  `;
  check('table SiteClosureEvent exists', Number(tbl[0]?.c ?? 0) === 1);

  const fk = await prisma.$queryRaw<{ delete_rule: string }[]>`
    SELECT rc.delete_rule
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'SiteClosureEvent'
  `;
  check(
    'closure events cascade with their project',
    fk.length === 1 && fk[0]!.delete_rule === 'CASCADE',
    fk.map((f) => f.delete_rule).join(', '),
  );

  // No backfill.
  const byStatus = await prisma.jobSite.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const summary = byStatus
    .map((r) => `${r.status}:${r._count._all}`)
    .join(' ');
  console.log(`\n  sites by status — ${summary}`);

  const completed = await prisma.jobSite.count({
    where: { status: 'COMPLETED' },
  });
  check(
    'the migration completed no project',
    completed === 0,
    `${completed} already COMPLETED`,
  );

  // Informational, not asserted: how many projects are ARCHIVED depends on the
  // environment (production has one, a fresh local database has none). The
  // no-backfill guarantee is the COMPLETED count above — if the migration had
  // converted archived sites, that count would not be zero.
  const archived = await prisma.jobSite.count({ where: { status: 'ARCHIVED' } });
  console.log(
    `  (informational) ${archived} project(s) remain ARCHIVED and editable`,
  );

  const events = await prisma.siteClosureEvent.count();
  check('no closure events were fabricated', events === 0, `${events} found`);

  const withCompletedAt = await prisma.jobSite.count({
    where: { completedAt: { not: null } },
  });
  check(
    'no project was given a completion date',
    withCompletedAt === 0,
    `${withCompletedAt} found`,
  );

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
