/**
 * Induction validity standard (3 months / 91 days).
 *
 * Exercises the real service against the real database. What matters here is not
 * that a constant says 91 — it is that a returning operative actually skips the
 * induction inside the window, is asked for it outside, and that the two states
 * `null` still distinguishes ("every check-in" vs "not configured") did not get
 * collapsed by the change.
 *
 * Run: npx tsx scripts/inductionvalidity_verify.ts
 */
import { prisma } from '../lib/prisma';
import {
  DEFAULT_INDUCTION_VALIDITY_DAYS,
  VALIDITY_PRESETS,
  validityLabel,
} from '../services/induction/validityConstants';
import { getInductionValidity } from '../services/induction/inductionValidityService';

let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const DAY = 24 * 60 * 60 * 1000;
const made: { workers: string[]; sites: string[] } = { workers: [], sites: [] };

async function main() {
  console.log('== INDUCTION VALIDITY STANDARD ==\n');

  console.log('[1] The preset');
  const p = VALIDITY_PRESETS.find((x) => x.days === 91);
  chk('a 3-month preset exists', Boolean(p), p ? p.label : 'missing');
  chk('it is 91 days, a quarter of 365 — not 3×30', p?.days === 91);
  chk('the standard is 91', DEFAULT_INDUCTION_VALIDITY_DAYS === 91);
  chk('it labels as "3 months"', validityLabel(91) === '3 months', validityLabel(91));
  chk('null still labels as "Every check-in"', validityLabel(null) === 'Every check-in', validityLabel(null));

  console.log('\n[2] "Every check-in" is still selectable and still means that');
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const site = await prisma.jobSite.create({
    data: {
      name: 'Validity Test Site',
      addressLine1: '1 Test Way',
      town: 'Testville',
      postcode: 'TE1 1ST',
      jobReference: `VT-${process.pid}`,
      createdByAdminId: admin!.id,
    },
    select: { id: true },
  });
  made.sites.push(site.id);
  const worker = await prisma.worker.create({
    data: { mobile: `+4477009${String(process.pid).slice(-5).padStart(5, '0')}`, fullName: 'Validity Tester', company: 'Test' },
  });
  made.workers.push(worker.id);

  await prisma.siteInductionConfig.upsert({
    where: { jobSiteId: site.id },
    create: { jobSiteId: site.id, inductionValidityDays: null },
    update: { inductionValidityDays: null },
  });
  const off = await getInductionValidity(worker.id, site.id);
  chk('an explicit null still disables validity', off.enabled === false, JSON.stringify(off));

  console.log('\n[3] Inside the 91-day window, no re-induction');
  await prisma.siteInductionConfig.update({
    where: { jobSiteId: site.id },
    data: { inductionValidityDays: DEFAULT_INDUCTION_VALIDITY_DAYS },
  });
  const recent = await prisma.submission.create({
    data: {
      workerId: worker.id, jobSiteId: site.id, checklistVersion: 1, answers: {},
      status: 'COMPLIANT', gdprConsent: true, checkedInAt: new Date(Date.now() - 30 * DAY),
    },
  });
  const inside = await getInductionValidity(worker.id, site.id);
  chk('a 30-day-old induction is still valid', inside.enabled === true && inside.state === 'valid',
      `${inside.enabled ? (inside as any).state : 'disabled'}`);
  if (inside.enabled && inside.state === 'valid') {
    const days = Math.round((inside.expiresAt.getTime() - inside.completedAt.getTime()) / DAY);
    chk('it expires 91 days after the induction', days === 91, `${days} days`);
  }

  console.log('\n[4] Outside the window, re-induction is required');
  await prisma.submission.update({
    where: { id: recent.id },
    data: { checkedInAt: new Date(Date.now() - 92 * DAY) },
  });
  const outside = await getInductionValidity(worker.id, site.id);
  chk('a 92-day-old induction has expired',
      outside.enabled === true && outside.state === 'expired',
      outside.enabled ? (outside as any).state : 'disabled');
  if (outside.enabled && outside.state === 'expired') {
    chk('...and the reason is time, not invalidation', (outside as any).reason === 'time', (outside as any).reason);
  }

  console.log('\n[5] A manager can still force re-induction inside the window');
  await prisma.submission.update({ where: { id: recent.id }, data: { checkedInAt: new Date(Date.now() - 10 * DAY) } });
  await prisma.siteInductionConfig.update({
    where: { jobSiteId: site.id },
    data: { inductionsInvalidatedAt: new Date(), invalidatedByName: 'Test' },
  });
  const inv = await getInductionValidity(worker.id, site.id);
  chk('invalidation overrides a valid window',
      inv.enabled === true && inv.state === 'expired' && (inv as any).reason === 'invalidated',
      inv.enabled ? `${(inv as any).state}/${(inv as any).reason}` : 'disabled');

  console.log('\n[6] A NEW site gets the standard without anyone configuring it');
  const src = require('fs').readFileSync('services/sites/platformSiteService.ts', 'utf8');
  const src2 = require('fs').readFileSync('services/sites/adminSiteService.ts', 'utf8');
  chk('platform site creation writes the standard', /inductionValidityDays: DEFAULT_INDUCTION_VALIDITY_DAYS/.test(src));
  chk('admin site creation writes it too', /inductionValidityDays: DEFAULT_INDUCTION_VALIDITY_DAYS/.test(src2));
  chk('the standard is NOT a null fallback',
      !/inductionValidityDays \?\? DEFAULT_INDUCTION_VALIDITY_DAYS/.test(
        require('fs').readFileSync('services/induction/inductionValidityService.ts', 'utf8')),
      'null must keep meaning "every check-in"');

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const id of made.workers) {
    await prisma.submission.deleteMany({ where: { workerId: id } });
    await prisma.worker.deleteMany({ where: { id } });
  }
  for (const id of made.sites) {
    await prisma.siteInductionConfig.deleteMany({ where: { jobSiteId: id } });
    await prisma.submission.deleteMany({ where: { jobSiteId: id } });
    await prisma.jobSite.deleteMany({ where: { id } });
  }
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
