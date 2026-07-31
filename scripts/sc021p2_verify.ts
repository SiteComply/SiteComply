import { PrismaClient } from '@prisma/client';

/**
 * SC-021 Phase 2 migration verification.
 *
 * Asserts the tables, the enum, the provenance columns and the CHECK
 * constraints — and that NOTHING was created. Zero templates and zero policies
 * is the correct post-migration state: behaviour must be unchanged until
 * somebody deliberately makes a template or sets a requirement.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('SiteConfigTemplate', 'SiteConfigTemplateItem', 'OrgServicePolicy')`,
  );
  const enumType = await prisma.$queryRawUnsafe<{ typname: string }[]>(
    `SELECT typname FROM pg_type WHERE typname = 'SiteConfigTemplateCategory'`,
  );
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'JobSite'
       AND column_name IN ('appliedConfigTemplateName','appliedConfigTemplateAt','appliedConfigTemplateBy')`,
  );
  const checks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'c' AND conname IN
       ('SiteConfigTemplateItem_one_target', 'OrgServicePolicy_one_target')`,
  );

  const templates = await prisma.siteConfigTemplate.count();
  const policies = await prisma.orgServicePolicy.count();
  const sitesWithProvenance = await prisma.jobSite.count({
    where: { appliedConfigTemplateName: { not: null } },
  });

  console.log('      tables:', tables.length, 'of 3');
  console.log('      category enum:', enumType.length, 'of 1');
  console.log('      provenance columns:', cols.length, 'of 3');
  console.log('      CHECK constraints:', checks.length, 'of 2');
  console.log('      templates:', templates, '(expect 0 — none seeded)');
  console.log('      company policies:', policies, '(expect 0 — no behaviour change)');
  console.log('      sites with provenance:', sitesWithProvenance, '(expect 0)');

  const ok =
    tables.length === 3 &&
    enumType.length === 1 &&
    cols.length === 3 &&
    checks.length === 2 &&
    templates === 0 &&
    policies === 0 &&
    sitesWithProvenance === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
