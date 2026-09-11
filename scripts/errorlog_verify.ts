/**
 * Error logging — unit-level behaviour against the real database.
 *
 * The HTTP half (a real failing route, a real browser crash) is covered by
 * scripts/errorlog_http_verify.js. This covers the rules that are easy to get
 * silently wrong: redaction, query-string stripping, deduping and retention.
 *
 * Run: npx tsx scripts/errorlog_verify.ts
 */
import { prisma } from '../lib/prisma';
import {
  recordError,
  purgeOldErrors,
  redact,
  pathOnly,
  fingerprintOf,
  RETENTION_DAYS,
} from '../services/telemetry/errorLog';
import { CLOSED_PROJECT_WRITABLE_MODELS } from '../services/projectClosure/projectWritable';

let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const MARK = `verify-${process.pid}`;

async function main() {
  console.log('== ERROR LOGGING ==\n');

  console.log('[1] Sensitive data never reaches the table');
  chk('an email is redacted', redact('failed for bob.smith@example.com') === 'failed for [email]');
  chk('a UK mobile is redacted', !/447700900123/.test(redact('sms to +447700900123 failed')),
      redact('sms to +447700900123 failed'));
  // Assert the PROPERTY, not which rule catches it: the first version of this
  // checked for the literal '[token]' and failed on a string that was correctly
  // redacted by the authorization rule instead. What matters is that the secret
  // is not in the output.
  const secret = 'eyJhbGciOiJIUzI1NiJ9abc';
  chk('a bearer token does not survive',
      !redact(`Authorization: Bearer ${secret}`).includes(secret),
      redact(`Authorization: Bearer ${secret}`));
  chk('a bare token does not survive',
      !redact(`token ${secret}`).includes(secret));
  chk('an api key does not survive',
      !redact('sk-abcdefghijklmno').includes('abcdefghijklmno'));
  chk('a password value does not survive', !redact('password="hunter2"').includes('hunter2'));

  console.log('\n[2] Query strings are stripped — they carry names and dates');
  chk('from a full URL',
      pathOnly('https://app.sitecomply.co.uk/platform/dashboard/submissions?worker=Bob%20Smith&from=2026-01-01')
        === '/platform/dashboard/submissions');
  chk('from a bare path', pathOnly('/platform/x?q=secret') === '/platform/x');
  chk('a hash is dropped too', pathOnly('/a/b?x=1#frag') === '/a/b');

  console.log('\n[3] A record carries what an investigator needs');
  const ref = await recordError({
    kind: 'SERVER_ROUTE',
    portal: 'PLATFORM',
    name: 'TypeError',
    message: `${MARK} cannot read properties of undefined`,
    stack: `TypeError: boom\n    at handler (/app/route.js:10:5)\n    at next (/app/x.js:2:1)`,
    route: '/api/platform/sites/abc/gps?secret=leak',
    method: 'PATCH',
    statusCode: 500,
    buildId: 'TEST_BUILD',
    userRef: 'platform:u1',
    userName: 'Test Director',
    userRole: 'DIRECTOR',
    pagePath: '/platform/dashboard/sites/abc?tab=x',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewportWidth: 390,
    viewportHeight: 844,
  });
  chk('a reference was issued', Boolean(ref), ref ?? 'none');
  chk('the reference is human-quotable', /^SC-E-\d{5}$/.test(ref ?? ''), ref ?? '');
  const row = await prisma.errorEvent.findFirst({ where: { reference: ref ?? '' } });
  chk('who', row?.userName === 'Test Director' && row?.userRole === 'DIRECTOR');
  chk('portal', row?.portal === 'PLATFORM');
  chk('page and route stored without their query strings',
      row?.pagePath === '/platform/dashboard/sites/abc' && row?.route === '/api/platform/sites/abc/gps',
      `${row?.pagePath} | ${row?.route}`);
  chk('which deploy', row?.buildId === 'TEST_BUILD');
  chk('browser derived from the user agent', row?.browser === 'Safari 17', row?.browser ?? 'null');
  chk('os derived', (row?.os ?? '').startsWith('iOS'), row?.os ?? 'null');
  chk('device derived', row?.deviceType === 'Phone', row?.deviceType ?? 'null');
  chk('viewport', row?.viewportWidth === 390 && row?.viewportHeight === 844);
  chk('the stack is kept', (row?.stack ?? '').includes('at handler'));
  chk('a timestamp is stamped', Boolean(row?.lastSeenAt));

  console.log('\n[4] A repeated fault folds instead of flooding');
  for (let i = 0; i < 5; i++) {
    await recordError({
      kind: 'CLIENT_RENDER', portal: 'WORKER',
      message: `${MARK} repeated boom`,
      stack: 'Error: x\n    at Page (/p.js:1:1)',
      pagePath: '/worker/dashboard',
    });
  }
  const folded = await prisma.errorEvent.findMany({
    where: { message: { contains: `${MARK} repeated boom` } },
  });
  chk('five reports became one row', folded.length === 1, `${folded.length} rows`);
  chk('...counted five times', folded[0]?.occurrences === 5, String(folded[0]?.occurrences));
  chk('firstSeenAt is preserved', Boolean(folded[0]?.firstSeenAt));

  console.log('\n[5] Different faults stay separate');
  const fpA = fingerprintOf({ kind: 'CLIENT_RENDER', message: 'boom', stack: 'at A (/a.js:1:1)' });
  const fpB = fingerprintOf({ kind: 'CLIENT_RENDER', message: 'boom', stack: 'at B (/b.js:1:1)' });
  chk('same message from a different place is a different fault', fpA !== fpB);
  const fpC = fingerprintOf({ kind: 'CLIENT_RENDER', message: 'boom for id cmtwg44ij0002h5qloxuwznmc', stack: 'at A (/a.js:1:1)' });
  const fpD = fingerprintOf({ kind: 'CLIENT_RENDER', message: 'boom for id cmrikozgg000113416mizkixz', stack: 'at A (/a.js:1:1)' });
  chk('the same fault about two records is ONE fault', fpC === fpD,
      'ids in a message would otherwise defeat deduping entirely');

  console.log('\n[6] Retention');
  chk('the retention period is 90 days', RETENTION_DAYS === 90);
  const old = await prisma.errorEvent.create({
    data: {
      kind: 'SERVER_ROUTE', portal: 'SYSTEM', message: `${MARK} ancient`,
      fingerprint: `${MARK}-ancient`,
      lastSeenAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      firstSeenAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const recent = await prisma.errorEvent.findFirst({ where: { reference: ref ?? '' }, select: { id: true } });
  const removed = await purgeOldErrors(RETENTION_DAYS);
  chk('the purge removed something', removed >= 1, `${removed} rows`);
  chk('a 91-day-old record is gone',
      (await prisma.errorEvent.findUnique({ where: { id: old.id } })) === null);
  chk('a recent record survives',
      (await prisma.errorEvent.findUnique({ where: { id: recent!.id } })) !== null);

  console.log('\n[7] The logger cannot break the app');
  const bad = await recordError({
    kind: 'SERVER_ROUTE', portal: 'PLATFORM',
    message: 'x'.repeat(50_000),
    stack: 'y'.repeat(100_000),
  });
  chk('an enormous payload is accepted and capped', Boolean(bad));
  const capped = await prisma.errorEvent.findFirst({ where: { reference: bad ?? '' } });
  chk('message capped', (capped?.message.length ?? 0) <= 2_000, String(capped?.message.length));
  chk('stack capped', (capped?.stack?.length ?? 0) <= 8_000, String(capped?.stack?.length));

  console.log('\n[8] It still works on a completed project');
  chk('ErrorEvent is writable when a project is closed',
      CLOSED_PROJECT_WRITABLE_MODELS.has('ErrorEvent'),
      'otherwise the read-only guard blocks the logger exactly when it matters');

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await prisma.errorEvent.deleteMany({ where: { OR: [
    { message: { contains: MARK } }, { fingerprint: { contains: MARK } },
    { message: { startsWith: 'xxxx' } },
  ] } }).catch(() => {});
  console.log('   cleaned up fixtures');
  await prisma.$disconnect();
});
