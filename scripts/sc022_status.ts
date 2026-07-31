import { PrismaClient } from '@prisma/client';

/** SC-022 read-only production state: who has been narrowed, and by whom. */
const prisma = new PrismaClient();

async function main() {
  const [overrides, logs, users] = await Promise.all([
    prisma.siteUserPermission.findMany({
      include: {
        platformUser: { select: { name: true, role: true } },
        jobSite: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.permissionChangeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.platformUser.groupBy({
      by: ['role'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    }),
  ]);

  console.log('active platform users by role:');
  for (const u of users) console.log(`  ${u.role}: ${u._count._all}`);

  console.log(`\npermission overrides: ${overrides.length}`);
  for (const o of overrides) {
    console.log(
      `  ${o.platformUser.name} (${o.platformUser.role}) @ ${o.jobSite.name} · ${o.module} → ${o.verbs.join('/') || 'no access'} · by ${o.updatedByName ?? '—'}`,
    );
  }

  console.log(`\nrecent permission changes: ${logs.length}`);
  for (const l of logs) {
    console.log(
      `  ${l.createdAt.toISOString()} ${l.actorName} ${l.action} ${l.targetName} @ ${l.jobSiteName}${l.module ? ` (${l.module})` : ''}`,
    );
  }

  if (overrides.length === 0) {
    console.log(
      '\nNo overrides — every user still has their full role access, exactly as before SC-022.',
    );
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
