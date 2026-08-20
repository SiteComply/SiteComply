import { PrismaClient } from '@prisma/client';

/**
 * Create the real Platform account jc@parryst.com (ACTIVE, DIRECTOR) in
 * production, so the account-scoped dev override can be allow-listed to it.
 *
 * Guarded: refuses if a parryst.com account already exists, and verifies exactly
 * one row afterwards. Name/company are placeholders the owner can edit in the UI.
 */
const EMAIL = 'jc@parryst.com';

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.platformUser.findFirst({
      where: { email: { contains: 'parryst', mode: 'insensitive' } },
      select: { email: true },
    });
    if (existing) {
      console.log('REFUSING: a parryst account already exists:', existing.email);
      process.exit(1);
    }

    const created = await prisma.platformUser.create({
      data: {
        email: EMAIL,
        name: 'JC',
        company: 'Parry St',
        role: 'DIRECTOR',
        status: 'ACTIVE',
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    console.log('CREATED:', JSON.stringify(created));

    const count = await prisma.platformUser.count({ where: { email: EMAIL } });
    if (count !== 1) {
      console.log('*** VERIFY FAILED — expected exactly 1 row, found', count);
      process.exit(1);
    }
    console.log('VERIFIED: exactly one', EMAIL, 'account, ACTIVE DIRECTOR.');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
