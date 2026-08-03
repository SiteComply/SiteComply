/**
 * SC-024 Phase 2 migration verifier — the five ZIP columns on CloseOutPack.
 *
 * Additive only: every column is nullable or defaulted, so existing packs stay
 * valid with no backfill. A pack with no zipBlobPath simply has no archive yet,
 * which is exactly what the UI reports.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPECTED: Record<string, { nullable: boolean; type: string }> = {
  zipBlobPath: { nullable: true, type: 'text' },
  zipSizeBytes: { nullable: true, type: 'integer' },
  zipGeneratedAt: { nullable: true, type: 'timestamp without time zone' },
  zipTruncated: { nullable: false, type: 'boolean' },
  zipFileCount: { nullable: true, type: 'integer' },
};

async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

  console.log('== SC-024 P2 schema verification ==');

  const cols = await prisma.$queryRaw<
    { column_name: string; is_nullable: string; data_type: string; column_default: string | null }[]
  >`
    SELECT column_name, is_nullable, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'CloseOutPack' AND column_name LIKE 'zip%'
    ORDER BY column_name
  `;

  for (const [name, spec] of Object.entries(EXPECTED)) {
    const col = cols.find((c) => c.column_name === name);
    if (!col) {
      check(`${name} exists`, false, 'column missing');
      continue;
    }
    check(
      `${name} (${col.data_type}, ${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`,
      col.data_type === spec.type &&
        (col.is_nullable === 'YES') === spec.nullable,
      `expected ${spec.type}, ${spec.nullable ? 'nullable' : 'not null'}`,
    );
  }

  // zipTruncated is NOT NULL, so it must carry a default or the migration would
  // have failed against existing rows.
  const trunc = cols.find((c) => c.column_name === 'zipTruncated');
  check(
    'zipTruncated defaults to false',
    !!trunc?.column_default?.includes('false'),
    `default: ${trunc?.column_default ?? 'none'}`,
  );

  const total = await prisma.closeOutPack.count();
  const withZip = await prisma.closeOutPack.count({
    where: { zipBlobPath: { not: null } },
  });
  console.log(
    `\n  packs: ${total} total, ${withZip} with an archive (no backfill expected)`,
  );
  // Run at migration time, before any archive can exist: every pre-existing pack
  // must come through with no archive attached. If this is non-zero the
  // migration did something it was never supposed to do.
  check(
    'no pack was given an archive by the migration',
    withZip === 0,
    `${withZip} packs already carry a zipBlobPath`,
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
