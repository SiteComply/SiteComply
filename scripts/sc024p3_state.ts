import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  console.log('packs:', await p.closeOutPack.count());
  console.log('packs with a narrative:', await p.closeOutPack.count({ where: { aiSummary: { not: null } } }));
  console.log('share links:', await p.closeOutPackShare.count());
  console.log('share views:', await p.closeOutPackShareView.count());
  console.log('AI summary log rows:', await p.aiSummary.count());
  console.log('  of which close-out:', await p.aiSummary.count({ where: { targetType: 'CLOSE_OUT_PACK' } }));
  await p.$disconnect();
})().catch(async (e) => { console.error(String(e).slice(0,200)); await p.$disconnect(); process.exit(1); });
