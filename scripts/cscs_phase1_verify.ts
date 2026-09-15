/**
 * CSCS cutover, Phase 1 — stop presenting mock results as real verification.
 *
 * The assertions are about CLAIMS, not plumbing: what the product asserts to an
 * operative and to a manager about a card it has not actually checked.
 *
 * Run: npx tsx scripts/cscs_phase1_verify.ts
 */
import { readFileSync } from 'node:fs';
import { MockCscsProvider, mockIsInert } from '../services/cscs/mockProvider';

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

async function withEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  // `process.env` rejects defineProperty, so assign through a loosened view.
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV;
  env.NODE_ENV = value;
  try { return await fn(); }
  finally { env.NODE_ENV = prev; }
}

async function main() {
  console.log('== CSCS PHASE 1 ==\n');
  const mock = new MockCscsProvider();
  const card = { cardNumber: '12345678', holderName: 'A Tester', scheme: null, cardTypeHint: null, expiryHint: null };

  console.log('[1] In production the mock verifies nothing');
  await withEnv('production', async () => {
    chk('the inert rule is on in production', mockIsInert());
    const r = await mock.verifyCard(card as never);
    chk('status is UNVERIFIED', r.status === 'UNVERIFIED', r.status);
    chk('verified is false', r.verified === false);
    chk('no scheme invented', r.scheme === null, String(r.scheme));
    chk('no expiry invented', !r.expiry, String(r.expiry));
    chk('no qualifications invented', !r.qualifications || r.qualifications.length === 0);
    chk('the message does not claim CSCS', !/CSCS Smart Check service/i.test(r.message), r.message);
    chk('...and explains why', /not switched on yet/i.test(r.message));
  });

  console.log('\n[2] Locally it still works, so the journey stays testable');
  await withEnv('development', async () => {
    chk('the inert rule is off outside production', !mockIsInert());
    const r = await mock.verifyCard(card as never);
    chk('a card still verifies', r.verified === true, r.status);
    chk('but it never claims CSCS', !/CSCS Smart Check service/i.test(r.message), r.message);
    chk('...it says it is a test check', /test check/i.test(r.message), r.message);
  });

  console.log('\n[3] No mock message anywhere claims a CSCS verification');
  const src = read('services/cscs/mockProvider.ts');
  const claims = src
    .split('\n')
    .filter((l) => /message:/.test(l) && /CSCS Smart Check service/i.test(l));
  chk('no message string asserts Smart Check', claims.length === 0, claims.join(' | '));

  console.log('\n[4] The operative is not promised a check that will not run');
  const form = read('components/checkin/IdentityForm.tsx');
  chk('the promise is conditional on verification being live',
      /verificationLive[\s\S]{0,120}verify your card against the CSCS Smart Check service/.test(form));
  chk('...with an honest alternative',
      /Automatic CSCS checking is not switched on yet/.test(form));
  chk('"not checked" is not shown as a failure',
      /notChecked[\s\S]{0,200}Card details recorded/.test(form));

  console.log('\n[5] A manager can tell a test result from a real one');
  const page = read('app/platform/dashboard/workers/[id]/page.tsx');
  chk('the label names the provider',
      /verifiedByProvider === 'mock'[\s\S]{0,120}Card check \(test provider\)/.test(page));
  chk('and says plainly it is not a CSCS verification',
      /Not a CSCS verification/.test(page));
  const svc = read('services/workers/workerDetailService.ts');
  chk('the provider comes from the verification log, not a guess',
      /cscsVerifications:[\s\S]{0,160}provider: true/.test(svc));

  console.log('\n[6] One predicate decides whether verification is live');
  const cfg = read('services/cscs/cscsConfigService.ts');
  chk('cscsVerificationIsLive exists', /export async function cscsVerificationIsLive/.test(cfg));
  chk('the mock never counts as live', /providerId === 'mock'\) return false/.test(cfg));
  chk('and it needs credentials', /runtime\.apiUrl && runtime\.apiKey/.test(cfg));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}
main();
