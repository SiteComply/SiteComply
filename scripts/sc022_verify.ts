import { PrismaClient } from '@prisma/client';

/**
 * SC-022 Phase 1 migration verification.
 *
 * Asserts the tables and indexes exist AND that no override rows were created.
 * Zero is the only correct post-migration state: an override row present after
 * deploy would mean somebody's access had been silently reduced, which this
 * phase explicitly does not do.
 */
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('SiteUserPermission', 'PermissionChangeLog')`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname = 'SiteUserPermission_platformUserId_jobSiteId_module_key'`,
  );
  const fks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text = '"SiteUserPermission"'`,
  );
  // The audit log must have NO foreign keys: it has to survive deletion of the
  // user, the actor or the site.
  const logFks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text = '"PermissionChangeLog"'`,
  );

  const overrides = await prisma.siteUserPermission.count();
  const logs = await prisma.permissionChangeLog.count();
  const activeUsers = await prisma.platformUser.count({
    where: { status: 'ACTIVE' },
  });

  console.log('      tables:', tables.length, 'of 2');
  console.log('      unique index:', idx.length, 'of 1');
  console.log('      SiteUserPermission FKs:', fks.length, 'of 2');
  console.log('      PermissionChangeLog FKs:', logFks.length, '(expect 0 — trail must outlive its subjects)');
  console.log('      override rows:', overrides, '(expect 0 — nobody reduced on deploy)');
  console.log('      change-log rows:', logs, '(expect 0)');
  console.log('      active platform users unaffected:', activeUsers);

  const ok =
    tables.length === 2 &&
    idx.length === 1 &&
    fks.length === 2 &&
    logFks.length === 0 &&
    overrides === 0 &&
    logs === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
