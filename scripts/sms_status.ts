import { PrismaClient } from '@prisma/client';

/** Read-only production SMS state: provider, switch, recent messages, usage. */
const prisma = new PrismaClient();

async function main() {
  const cfg = await prisma.smsConfig.findUnique({ where: { id: 'sms' } });
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [total, failed, byPurpose, recent] = await Promise.all([
    prisma.smsMessageLog.count({ where: { createdAt: { gte: since } } }),
    prisma.smsMessageLog.count({ where: { createdAt: { gte: since }, ok: false } }),
    prisma.smsMessageLog.groupBy({
      by: ['purpose'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.smsMessageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);

  console.log(`active provider: ${cfg?.activeProvider ?? '(no row — env default, currently mock)'}`);
  console.log(`sending enabled: ${cfg?.sendingEnabled ?? '(default true)'}`);
  console.log(`\nlast 30 days: ${total} messages (${failed} failed)`);
  for (const p of byPurpose) console.log(`  ${p.purpose}: ${p._count._all}`);
  console.log(`\nrecent (${recent.length}):`);
  for (const r of recent) {
    console.log(
      `  ${r.createdAt.toISOString()} ${r.purpose} → ${r.toMasked} via ${r.provider} · ${r.ok ? 'sent' : 'FAILED: ' + (r.error ?? '')}`,
    );
  }
  if (!cfg || cfg.activeProvider === 'mock') {
    console.log('\nStill on MOCK — no real SMS is being sent and nothing is billable.');
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
