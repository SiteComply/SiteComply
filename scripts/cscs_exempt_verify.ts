/**
 * SC-001 — the exempt test account.
 *
 * ONE PROPERTY MATTERS ABOVE ALL: the exemption must never mark anyone
 * compliant. A bypass that fails towards "not verified" is a nuisance; one that
 * fails towards "verified" is a competent-looking record for a card nobody
 * checked. Everything else here is scope and visibility.
 */
import { readFileSync } from 'fs';
import {
  isCscsExemptMobile,
  cscsExemptionIsActive,
  cscsExemptMobiles,
} from '../services/cscs/cscsExemptAccounts';
import { MockCscsProvider } from '../services/cscs/mockProvider';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const EXEMPT = '+447700900150';
const OTHER = '+447700900999';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ── OFF BY DEFAULT. Both variables required, no exceptions. ───────────────
{
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: undefined, CSCS_MOCK_MOBILES: undefined }, () => {
    ok('with nothing configured, nobody is exempt', !isCscsExemptMobile(EXEMPT));
    ok('  and the mechanism reports itself off', !cscsExemptionIsActive());
    ok('  with an empty list', cscsExemptMobiles().length === 0);
  });
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: '1', CSCS_MOCK_MOBILES: undefined }, () => {
    ok('enabled but no list: nobody is exempt', !isCscsExemptMobile(EXEMPT));
  });
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: undefined, CSCS_MOCK_MOBILES: EXEMPT }, () => {
    ok('a list but not enabled: nobody is exempt', !isCscsExemptMobile(EXEMPT));
  });
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: '0', CSCS_MOCK_MOBILES: EXEMPT }, () => {
    ok('"0" does not enable it', !isCscsExemptMobile(EXEMPT));
  });
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: 'true', CSCS_MOCK_MOBILES: EXEMPT }, () => {
    ok('"true" does not enable it either - only "1"', !isCscsExemptMobile(EXEMPT));
  });
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: '1', CSCS_MOCK_MOBILES: '  ,  ,' }, () => {
    ok('a list of blanks exempts nobody', !isCscsExemptMobile(EXEMPT));
    // ...and the mechanism must report itself OFF, not "on with nobody on it".
    // An empty allow-list that claims to be active is a switch that looks armed
    // and does nothing, which is how a real exemption later goes unnoticed.
    ok('  and the mechanism reports itself off, not empty-but-on',
      !cscsExemptionIsActive(), cscsExemptMobiles());
  });

  // A null mobile must be REFUSED, not thrown on. The list lookup calls .trim(),
  // so an unguarded null crashes the whole verification rather than declining
  // the exemption - a check-in failing outright instead of a card not verifying.
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: '1', CSCS_MOCK_MOBILES: EXEMPT }, () => {
    let threw = false;
    let result: boolean | null = null;
    try { result = isCscsExemptMobile(null); } catch { threw = true; }
    ok('a null mobile does not throw', !threw);
    ok('  and is not exempt', result === false, result);
  });
}

// ── SCOPE: only the listed number, and nothing near it ────────────────────
{
  withEnv({ CSCS_MOCK_MOBILES_ENABLED: '1', CSCS_MOCK_MOBILES: EXEMPT }, () => {
    ok('the listed number is exempt', isCscsExemptMobile(EXEMPT));
    ok('  exactly one number is listed', cscsExemptMobiles().length === 1, cscsExemptMobiles());
    ok('another operative is NOT exempt', !isCscsExemptMobile(OTHER));
    // Near-misses. An off-by-one here would silently exempt a real worker.
    for (const near of [
      '+447700900151', '+44770090015', '+4477009001500', '447700900150',
      '07700900150', '+447700900150 ', ' +447700900150',
    ]) {
      const exempt = isCscsExemptMobile(near);
      const shouldBe = near.trim() === EXEMPT;
      ok(`"${near}" exempt=${exempt}`, exempt === shouldBe, { near, exempt, shouldBe });
    }
    ok('null is not exempt', !isCscsExemptMobile(null));
    ok('undefined is not exempt', !isCscsExemptMobile(undefined));
    ok('an empty string is not exempt', !isCscsExemptMobile(''));
  });
}

// ── THE SAFETY PROPERTY: an exempt worker can never be marked compliant ───
async function checkSafetyProperty() {
  const saved = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    const r = await new MockCscsProvider().verifyCard(
      { cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' } as never,
    );
    ok('an exempt worker is routed to a provider that returns UNVERIFIED',
      r.status === 'UNVERIFIED', r.status);
    ok('  and is NEVER marked verified', r.verified === false, r.verified);
    ok('  with a message that does not claim a check happened',
      /not switched on|not been verified/i.test(r.message), r.message);
  } finally {
    if (saved === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = saved;
  }
}

async function main() {
  await checkSafetyProperty();

  // ── WIRING: one branch, at the single point that decides ───────────────
  const idx = read('services/cscs/index.ts');
  ok('the exemption is honoured in resolveCscsProvider', /isCscsExemptMobile\(e164Mobile\)/.test(idx));
  ok('  exactly once - one place to read, one place to delete',
    (idx.match(/isCscsExemptMobile\(/g) ?? []).length === 1, idx.match(/isCscsExemptMobile\(/g));
  ok('  routing to the mock, not skipping the check',
    /isCscsExemptMobile\(e164Mobile\)\) \{\s*\n\s*return buildCscsProvider\('mock'\);/.test(idx), 'not routed to mock');
  ok('a caller that does not know the mobile gets the LIVE provider',
    /e164Mobile\?: string \| null/.test(idx), 'mobile not optional-safe');

  const svc = read('services/cscs/cscsVerificationService.ts');
  ok('the verification service passes the mobile through',
    /resolveCscsProvider\(input\.mobile\)/.test(svc), 'not passed');
  ok('  and still logs the attempt like any other',
    /provider: provider\.name/.test(svc), 'attempt not logged');

  const route = read('app/api/worker/profile/route.ts');
  ok('the profile route supplies the session mobile', /mobile: session\.mobile/.test(route));

  // ── NOT A DATABASE FLAG ─────────────────────────────────────────────────
  const schema = read('prisma/schema.prisma');
  ok('no database column was added for this', !/cscsExempt|cscsVerificationExempt/.test(schema), 'schema changed');
  ok('the module is env-gated only', !/prisma/.test(read('services/cscs/cscsExemptAccounts.ts')), 'reads the database');

  // ── VISIBLE, and removable without a deploy ─────────────────────────────
  const page = read('app/platform/dashboard/workers/[id]/page.tsx');
  ok('the admin screen states the exemption', /Exempt from CSCS Smart Check/.test(page));
  ok('  and says it is by design, not a fault', /unverified by design/.test(page));
  ok('  and that it is configuration, not code', /without a release/.test(page));
  const detail = read('services/workers/workerDetailService.ts');
  ok('the flag is read live, never stored', /isCscsExemptMobile\(worker\.mobile\)/.test(detail));

  const mod = read('services/cscs/cscsExemptAccounts.ts');
  ok('removal is documented', /TO REMOVE/.test(mod));
  ok('  and does not require a deploy', /No deploy needed/.test(mod));
  ok('it is kept separate from WORKER_TEST_LOGIN', /SEPARATE FROM WORKER_TEST_LOGIN/.test(mod));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
