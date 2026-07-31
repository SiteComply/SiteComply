import { PrismaClient } from '@prisma/client';

/** SC-021 read-only production state: catalogues and any per-site overrides. */
const prisma = new PrismaClient();

async function main() {
  const [permitTypes, templates, pOver, aOver, sites] = await Promise.all([
    prisma.permitType.count({ where: { active: true } }),
    prisma.auditTemplate.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { name: true },
    }),
    prisma.sitePermitTypeSetting.findMany({
      include: {
        jobSite: { select: { name: true } },
        permitType: { select: { name: true } },
      },
    }),
    prisma.siteActivityTypeSetting.findMany({
      include: {
        jobSite: { select: { name: true } },
        auditTemplate: { select: { name: true } },
      },
    }),
    prisma.jobSite.count({ where: { status: 'ACTIVE' } }),
  ]);

  console.log(`active sites: ${sites}`);
  console.log(`active permit types: ${permitTypes}`);
  console.log(`active activity types (${templates.length}):`);
  for (const t of templates) console.log(`  - ${t.name}`);
  console.log(`\noverrides — permit types: ${pOver.length}`);
  for (const r of pOver) {
    console.log(
      `  ${r.jobSite.name} · ${r.permitType.name} · enabled=${r.enabled} · by ${r.updatedByName ?? '—'}`,
    );
  }
  console.log(`overrides — activity types: ${aOver.length}`);
  for (const r of aOver) {
    console.log(
      `  ${r.jobSite.name} · ${r.auditTemplate.name} · enabled=${r.enabled} · by ${r.updatedByName ?? '—'}`,
    );
  }
  console.log(
    pOver.length + aOver.length === 0
      ? '\nNo overrides — every site still offers everything, as before SC-021.'
      : '',
  );
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
