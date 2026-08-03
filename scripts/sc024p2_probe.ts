import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.companyConfig.findFirst();
  console.log('company config row:', c ? 'present' : 'none');
  if (c) {
    console.log('  name:', c.companyName ?? '(unset)');
    console.log('  logo:', c.logoBlobPath ? 'uploaded' : 'none');
    console.log('  tagline:', c.tagline ?? '(unset)');
  }
  console.log('close-out packs generated:', await prisma.closeOutPack.count());
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
