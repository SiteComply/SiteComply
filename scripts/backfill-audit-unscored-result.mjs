/**
 * Repair audits recorded as FAILED when they had simply never been scored.
 *
 * `didPass` used to return `false` when `percent` was null (nothing scorable
 * answered yet), and that false was persisted to `calculatedPassed`. The
 * register and the audit detail page then showed "Not yet scored" alongside
 * "Fail". The code now returns null in that case; this clears the rows written
 * before the fix.
 *
 * The mandatory gate is preserved exactly: an audit with any mandatory item
 * answered FAIL is a genuine failure even with no percent, so those are left
 * alone. Only audits with no mandatory failure are reset to "not known yet".
 *
 * Idempotent. --apply to write; default is a dry run.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

const candidates = await p.audit.findMany({
  where: { scoringEnabled: true, calculatedPercent: null, calculatedPassed: false },
  select: { id: true, title: true, status: true },
});

let fixed = 0;
for (const a of candidates) {
  const mandatoryFailures = await p.auditItem.count({
    where: { auditId: a.id, mandatory: true, result: 'FAIL' },
  });
  if (mandatoryFailures > 0) {
    console.log(`KEEP  ${a.id}  "${a.title}" — ${mandatoryFailures} mandatory failure(s), genuine Fail`);
    continue;
  }
  console.log(`${APPLY ? 'FIX  ' : 'WOULD'} ${a.id}  "${a.title}" (${a.status}) — Fail -> not yet scored`);
  if (APPLY) {
    await p.audit.update({ where: { id: a.id }, data: { calculatedPassed: null } });
  }
  fixed += 1;
}

console.log(`EXAMINED=${candidates.length} FIXED=${fixed} APPLY=${APPLY}`);
await p.$disconnect();
