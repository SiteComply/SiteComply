import { PrismaClient } from '@prisma/client';
import { seedPermitTypes } from '@/services/permits/permitCatalogSeed';

/**
 * Idempotent seed of the SC-009 permit-type catalogue. Run locally with
 * `npx tsx scripts/seed-permit-types.ts`, and in production from the deploy
 * script after the migration. Safe to run repeatedly.
 */
const prisma = new PrismaClient();
(async () => {
  const n = await seedPermitTypes(prisma);
  console.log(`Seeded/refreshed ${n} permit types.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
