import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const row: any[] = await p.$queryRawUnsafe(
    'SELECT enabled, "activeProvider", "allowedRoles" FROM "AiConfig" LIMIT 1',
  );
  console.log(
    row.length
      ? `AiConfig row: enabled=${row[0].enabled} provider=${row[0].activeProvider} roles=${JSON.stringify(row[0].allowedRoles)}`
      : 'AiConfig: NO ROW (env applies: enabled=true, azure-openai, DIRECTOR+PROJECT_MANAGER)',
  );
  console.log('AiSummary rows:', await p.aiSummary.count());
  console.log('CloseOutPack rows:', await p.closeOutPack.count());
  await p.$disconnect();
})().catch(async (e) => {
  console.error(String(e).slice(0, 300));
  await p.$disconnect();
  process.exit(1);
});
