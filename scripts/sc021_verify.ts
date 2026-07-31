import { PrismaClient } from '@prisma/client';

/**
 * SC-021 Phase 1 migration verification.
 *
 * Checks the two availability tables exist AND that nothing was backfilled —
 * zero override rows is the correct post-migration state, because absence of a
 * row means "available" and every existing site must keep behaving exactly as
 * it did. Also confirms the two newly seeded templates are present.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('SitePermitTypeSetting', 'SiteActivityTypeSetting')`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname IN (
       'SitePermitTypeSetting_jobSiteId_permitTypeId_key',
       'SiteActivityTypeSetting_jobSiteId_auditTemplateId_key')`,
  );
  const fks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text IN
       ('"SitePermitTypeSetting"', '"SiteActivityTypeSetting"')`,
  );

  const permitRows = await prisma.sitePermitTypeSetting.count();
  const activityRows = await prisma.siteActivityTypeSetting.count();

  const newTemplates = await prisma.auditTemplate.findMany({
    where: {
      isSystem: true,
      name: { in: ['Temporary Works Inspection', 'Environmental Inspection'] },
    },
    select: { name: true, active: true, _count: { select: { items: true } } },
  });

  console.log('      tables:', tables.length, 'of 2');
  console.log('      unique indexes:', idx.length, 'of 2');
  console.log('      foreign keys:', fks.length, 'of 4');
  console.log(
    '      override rows:',
    permitRows + activityRows,
    '(expect 0 — no backfill; absent means available)',
  );
  for (const t of newTemplates) {
    console.log(
      `      seeded "${t.name}": active=${t.active}, ${t._count.items} items`,
    );
  }

  const ok =
    tables.length === 2 &&
    idx.length === 2 &&
    fks.length === 4 &&
    permitRows === 0 &&
    activityRows === 0 &&
    newTemplates.length === 2 &&
    newTemplates.every((t) => t.active && t._count.items > 0);
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
