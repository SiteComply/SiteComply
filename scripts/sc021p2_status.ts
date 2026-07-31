import { PrismaClient } from '@prisma/client';

/** SC-021 Phase 2 read-only production state. */
const prisma = new PrismaClient();

async function main() {
  const [templates, policies, sites] = await Promise.all([
    prisma.siteConfigTemplate.findMany({
      include: { items: { select: { enabled: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.orgServicePolicy.findMany({
      include: {
        permitType: { select: { name: true } },
        auditTemplate: { select: { name: true } },
      },
    }),
    prisma.jobSite.findMany({
      where: { appliedConfigTemplateName: { not: null } },
      select: {
        name: true,
        appliedConfigTemplateName: true,
        appliedConfigTemplateBy: true,
      },
    }),
  ]);

  console.log(`configuration templates: ${templates.length}`);
  for (const t of templates) {
    console.log(
      `  ${t.name} [${t.category}] active=${t.active} · turns off ${t.items.filter((i) => !i.enabled).length} of ${t.items.length} · by ${t.createdByName ?? '—'}`,
    );
  }
  console.log(`company requirements: ${policies.length}`);
  for (const p of policies) {
    console.log(
      `  ${p.permitType?.name ?? p.auditTemplate?.name} — ${p.reason ?? 'no reason given'}`,
    );
  }
  console.log(`sites configured from a template: ${sites.length}`);
  for (const s of sites) {
    console.log(
      `  ${s.name} ← "${s.appliedConfigTemplateName}" by ${s.appliedConfigTemplateBy ?? '—'}`,
    );
  }
  if (templates.length + policies.length + sites.length === 0) {
    console.log(
      '\nNothing configured yet — behaviour identical to before Phase 2.',
    );
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
