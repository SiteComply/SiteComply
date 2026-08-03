import { PrismaClient } from '@prisma/client';

/**
 * SC-024 Phase 1 migration verification.
 *
 * Generating a pack is a read-only act over existing records, so the assertion
 * is simply that the table exists, its uniqueness guarantee is in place, and
 * NOTHING has been generated — a pack present straight after the migration
 * would mean something ran that nobody asked for.
 */
const prisma = new PrismaClient();

async function main() {
  const tbl = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'CloseOutPack'`,
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname = 'CloseOutPack_jobSiteId_version_key'`,
  );
  const fk = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text = '"CloseOutPack"'`,
  );

  const packs = await prisma.closeOutPack.count();
  const sites = await prisma.jobSite.count({ where: { status: 'ACTIVE' } });

  console.log('      CloseOutPack table:', tbl.length, 'of 1');
  console.log(
    '      unique (site, version) index:',
    idx.length,
    'of 1 — stops two generations claiming one version',
  );
  console.log('      foreign key:', fk.length, 'of 1');
  console.log('      packs generated:', packs, '(expect 0)');
  console.log('      active sites able to generate one:', sites);

  const ok = tbl.length === 1 && idx.length === 1 && fk.length === 1 && packs === 0;
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
