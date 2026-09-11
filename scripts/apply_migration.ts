import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
const p = new PrismaClient();
(async () => {
  const sql = readFileSync(process.argv[2], 'utf8');
  // Split on statement boundaries, keeping DO $$ ... $$ blocks intact.
  const parts: string[] = [];
  let buf = '', inDo = false;
  for (const line of sql.split('\n')) {
    if (/^\s*DO \$\$/.test(line)) inDo = true;
    buf += line + '\n';
    if (inDo && /\$\$;\s*$/.test(line.trim())) { inDo = false; parts.push(buf); buf = ''; continue; }
    if (!inDo && /;\s*$/.test(line.trim()) && !line.trim().startsWith('--')) { parts.push(buf); buf = ''; }
  }
  if (buf.trim()) parts.push(buf);
  let n = 0;
  for (const s of parts) {
    const body = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    if (!body) continue;
    await p.$executeRawUnsafe(body);
    n++;
  }
  console.log(`  applied ${n} statements`);
  await p.$disconnect();
})().catch((e) => { console.error('  FAILED:', e.message.slice(0, 300)); process.exit(1); });
