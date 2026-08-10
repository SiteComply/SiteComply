/**
 * SC-033 migration verifier — CSCS Smart Check readiness.
 *
 * Two new tables. The interesting assertions are the DEFAULTS and the delete
 * rule, not the presence of columns: a CscsConfig defaulting to anything other
 * than 'mock' would silently change how cards are verified, and a CASCADE on
 * the worker FK would destroy the audit trail on a GDPR erasure.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let failures = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failures += 1;
};

interface Col { column_name: string; data_type: string; is_nullable: string; column_default: string | null }

async function main() {
  console.log('== SC-033 schema verification ==');

  for (const table of ['CscsConfig', 'CscsVerificationLog']) {
    const t = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*)::bigint AS c FROM information_schema.tables WHERE table_name = '${table}'`,
    );
    check(`table ${table} exists`, Number(t[0]?.c ?? 0) === 1);
  }

  const cfg = await prisma.$queryRaw<Col[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_name = 'CscsConfig'`;
  const byCfg = new Map(cfg.map((c) => [c.column_name, c]));

  const provider = byCfg.get('activeProvider');
  check(
    "activeProvider defaults to 'mock' — today's behaviour",
    !!provider && (provider.column_default ?? '').includes('mock') && provider.is_nullable === 'NO',
    provider ? `default=${provider.column_default}` : 'missing',
  );
  const enabled = byCfg.get('verificationEnabled');
  check(
    'verificationEnabled defaults to true',
    !!enabled && (enabled.column_default ?? '').startsWith('true'),
    enabled ? `default=${enabled.column_default}` : 'missing',
  );
  for (const n of ['smartCheckApiUrl', 'smartCheckApiKey']) {
    const c = byCfg.get(n);
    check(`${n} is nullable with no default`, !!c && c.is_nullable === 'YES' && !c.column_default);
  }

  const log = await prisma.$queryRaw<Col[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_name = 'CscsVerificationLog'`;
  const byLog = new Map(log.map((c) => [c.column_name, c]));
  for (const n of ['cardNumberMasked', 'provider', 'status']) {
    check(`${n} is NOT NULL`, byLog.get(n)?.is_nullable === 'NO');
  }
  check('workerId is nullable (survives erasure)', byLog.get('workerId')?.is_nullable === 'YES');

  // THE DELETE RULE. CASCADE here would destroy the audit trail whenever a
  // worker is erased, which is exactly when it is most needed.
  const fk = await prisma.$queryRaw<{ delete_rule: string }[]>`
    SELECT rc.delete_rule FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'CscsVerificationLog'`;
  check(
    'worker FK is SET NULL, not CASCADE',
    fk.length === 1 && fk[0]!.delete_rule === 'SET NULL',
    fk.map((f) => f.delete_rule).join(', ') || 'none',
  );

  const cfgRows = await prisma.cscsConfig.count();
  const logRows = await prisma.cscsVerificationLog.count();
  console.log(`\n  CscsConfig rows: ${cfgRows} · CscsVerificationLog rows: ${logRows}`);
  check('no config row fabricated', cfgRows === 0, `${cfgRows}`);
  check('no audit rows fabricated', logRows === 0, `${logRows}`);

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
