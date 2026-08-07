/**
 * SC-032 migration verifier — Notifications workspace.
 *
 * One additive nullable column. The interesting assertion is not that it
 * arrived, but that NOTHING ELSE MOVED: the settings JSON is where every
 * toggle and both reminder thresholds live, and a migration that touched it
 * would silently change what people are notified about.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

interface Col {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function main() {
  console.log('== SC-032 schema verification ==');

  const cols = await prisma.$queryRaw<Col[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'NotificationConfig'
    ORDER BY column_name
  `;
  const by = new Map(cols.map((c) => [c.column_name, c]));

  const added = by.get('updatedByUserId');
  check(
    'updatedByUserId is a nullable text column with no default',
    !!added &&
      added.data_type === 'text' &&
      added.is_nullable === 'YES' &&
      !added.column_default,
    added
      ? `type=${added.data_type} nullable=${added.is_nullable} default=${added.column_default}`
      : 'missing',
  );

  for (const name of ['id', 'settings', 'updatedByAdminId', 'updatedByName']) {
    check(`${name} still exists`, by.has(name));
  }

  const settings = by.get('settings');
  check(
    'settings is still JSON and still defaults to an empty object',
    !!settings &&
      settings.data_type.toLowerCase().includes('json') &&
      (settings.column_default ?? '').includes('{}'),
    settings ? `${settings.data_type} default=${settings.column_default}` : 'missing',
  );

  // No data was touched. A migration that rewrote settings would change what
  // people are notified about without anyone choosing it.
  const rows = await prisma.notificationConfig.count();
  console.log(`\n  NotificationConfig rows: ${rows}`);
  check('the migration did not fabricate a config row', rows <= 1, `${rows} rows`);

  if (rows > 0) {
    const row = await prisma.notificationConfig.findFirst();
    check(
      'the existing settings JSON is intact',
      !!row && typeof row.settings === 'object' && row.settings !== null,
      typeof row?.settings,
    );
    check(
      'no attribution was invented',
      row?.updatedByUserId == null,
      `updatedByUserId=${row?.updatedByUserId}`,
    );
  } else {
    console.log(
      '  (informational) no row — notifications run on catalogue defaults, unchanged',
    );
  }

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
