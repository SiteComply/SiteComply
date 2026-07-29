import { PrismaClient } from '@prisma/client';
import { seedAuditTemplates } from '@/services/audits/auditTemplateSeed';

/**
 * Idempotent seed of the SC-013 starter audit-template library. Run locally with
 * `npx tsx scripts/seed-audit-templates.ts`, and in production from the deploy
 * script after the migration. Safe to run repeatedly.
 */
const prisma = new PrismaClient();
(async () => {
  const n = await seedAuditTemplates(prisma);
  console.log(`Seeded/refreshed ${n} audit templates.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
