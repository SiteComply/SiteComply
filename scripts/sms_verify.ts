import { PrismaClient } from '@prisma/client';

/**
 * Twilio SMS migration verification.
 *
 * The critical assertion is that the ACTIVE PROVIDER IS STILL MOCK. This deploy
 * adds the ability to send real messages; it must not start sending them. A
 * provider of "twilio" here would mean live SMS went out without the deployment
 * plan being approved.
 */
const prisma = new PrismaClient();

async function main() {
  const col = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'SmsConfig' AND column_name = 'sendingEnabled'`,
  );
  const tbl = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'SmsMessageLog'`,
  );
  const fk = await prisma.$queryRawUnsafe<{ confdeltype: string }[]>(
    `SELECT confdeltype FROM pg_constraint
     WHERE conname = 'SmsMessageLog_workerId_fkey'`,
  );

  const cfg = await prisma.smsConfig.findUnique({ where: { id: 'sms' } });
  const logged = await prisma.smsMessageLog.count();

  console.log('      sendingEnabled column:', col.length, 'of 1');
  console.log('      SmsMessageLog table:', tbl.length, 'of 1');
  console.log(
    '      workerId FK on delete:',
    fk[0]?.confdeltype === 'n' ? 'SET NULL (correct)' : `"${fk[0]?.confdeltype}" — EXPECTED SET NULL`,
  );
  console.log('      active provider:', cfg?.activeProvider ?? '(no row — env default)');
  console.log('      sending enabled:', cfg?.sendingEnabled ?? '(default true)');
  console.log('      messages logged:', logged, '(expect 0 — nothing sent yet)');

  const stillMock = !cfg || cfg.activeProvider === 'mock';
  const ok =
    col.length === 1 && tbl.length === 1 && fk[0]?.confdeltype === 'n' && stillMock;
  if (!stillMock) {
    console.log('      *** ACTIVE PROVIDER IS NOT MOCK — live SMS may be sending ***');
  }
  console.log(ok ? '      VERIFIED' : '      *** VERIFICATION FAILED ***');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
