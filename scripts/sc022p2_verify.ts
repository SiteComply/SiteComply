import { PrismaClient } from '@prisma/client';

/**
 * SC-022 Phase 2 migration verification.
 *
 * The built-in template SHOULD exist after this migration (the Access tab's
 * shipped button reads it), but there must be ZERO company defaults and ZERO
 * custom templates: nobody's access changes until someone chooses to apply
 * something.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('PermissionTemplate', 'PermissionTemplateItem', 'CompanyPermissionDefault')`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname IN (
       'PermissionTemplate_name_key',
       'PermissionTemplateItem_templateId_module_key',
       'CompanyPermissionDefault_company_module_key')`,
  );

  const builtIn = await prisma.permissionTemplate.findUnique({
    where: { name: 'Contractor (standard)' },
    include: { items: true },
  });
  const custom = await prisma.permissionTemplate.count({
    where: { isSystem: false },
  });
  const companyDefaults = await prisma.companyPermissionDefault.count();
  const overrides = await prisma.siteUserPermission.count();

  console.log('      tables:', tables.length, 'of 3');
  console.log('      unique indexes:', idx.length, 'of 3');
  console.log(
    '      built-in template:',
    builtIn ? `present, ${builtIn.items.length} sections, isSystem=${builtIn.isSystem}` : 'MISSING',
  );
  console.log('      custom templates:', custom, '(expect 0)');
  console.log('      company defaults:', companyDefaults, '(expect 0 — nobody restricted on deploy)');
  console.log('      site overrides:', overrides, '(unchanged by this phase)');

  const ok =
    tables.length === 3 &&
    idx.length === 3 &&
    !!builtIn &&
    builtIn.isSystem &&
    builtIn.items.length > 0 &&
    custom === 0 &&
    companyDefaults === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
