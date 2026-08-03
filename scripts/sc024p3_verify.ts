/**
 * SC-024 Phase 3 migration verifier.
 *
 * Additive: one enum value, four nullable columns on CloseOutPack, two new
 * tables. Nothing is backfilled, so every existing pack must come through with
 * no narrative and no shares.
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
  console.log('== SC-024 P3 schema verification ==');

  // 1. The enum value.
  const enumVals = await prisma.$queryRaw<{ enumlabel: string }[]>`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AiSummaryTarget'
  `;
  check(
    'AiSummaryTarget has CLOSE_OUT_PACK',
    enumVals.some((e) => e.enumlabel === 'CLOSE_OUT_PACK'),
    enumVals.map((e) => e.enumlabel).join(', '),
  );

  // 2. AI provenance columns.
  const aiCols = await prisma.$queryRaw<
    { column_name: string; is_nullable: string }[]
  >`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'CloseOutPack' AND column_name LIKE 'ai%'
    ORDER BY column_name
  `;
  for (const name of [
    'aiGeneratedAt',
    'aiGeneratedBy',
    'aiModel',
    'aiProvider',
    'aiPromptVersion',
    'aiSummary',
  ]) {
    const col = aiCols.find((c) => c.column_name === name);
    check(
      `${name} exists and is nullable`,
      !!col && col.is_nullable === 'YES',
      col ? `nullable=${col.is_nullable}` : 'missing',
    );
  }

  // 3. The two new tables.
  for (const table of ['CloseOutPackShare', 'CloseOutPackShareView']) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*)::bigint AS c FROM information_schema.tables WHERE table_name = $1`,
      table,
    );
    check(`table ${table} exists`, Number(rows[0]?.c ?? 0) === 1);
  }

  // 4. The unique index on tokenHash is what stops two shares sharing a secret
  //    and makes resolution a single indexed read.
  const idx = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'CloseOutPackShare'
  `;
  check(
    'tokenHash is uniquely indexed',
    idx.some((i) => i.indexname === 'CloseOutPackShare_tokenHash_key'),
    idx.map((i) => i.indexname).join(', '),
  );

  // 5. Cascades — a deleted pack must not leave live links behind.
  const fks = await prisma.$queryRaw<
    { constraint_name: string; delete_rule: string }[]
  >`
    SELECT rc.constraint_name, rc.delete_rule
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name IN ('CloseOutPackShare', 'CloseOutPackShareView')
  `;
  check(
    'share FKs cascade on delete',
    fks.length === 2 && fks.every((f) => f.delete_rule === 'CASCADE'),
    fks.map((f) => `${f.constraint_name}=${f.delete_rule}`).join(', '),
  );

  // 6. No backfill.
  const packs = await prisma.closeOutPack.count();
  const withNarrative = await prisma.closeOutPack.count({
    where: { aiSummary: { not: null } },
  });
  const shares = await prisma.closeOutPackShare.count();
  console.log(
    `\n  packs: ${packs}; with a narrative: ${withNarrative}; share links: ${shares}`,
  );
  check(
    'the migration gave no pack a narrative',
    withNarrative === 0,
    `${withNarrative} packs already carry one`,
  );
  check('the migration created no share links', shares === 0, `${shares} found`);

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
