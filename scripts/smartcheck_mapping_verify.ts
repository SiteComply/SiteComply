/**
 * SC-001 — does a verified card actually reach storage and the screen?
 *
 * SHAPE-INDEPENDENT ON PURPOSE. The partner's exact response field names are
 * still being confirmed, so this exercises the PLUMBING either side of the
 * mapper: a mapped result must be persisted in full, and what is persisted must
 * be what the screens read. Those two links break silently — a working
 * integration that verifies a card and then stores nothing looks identical to
 * one that never ran.
 */
import { readFileSync } from 'fs';
import { mapSmartCheckResponse } from '../services/cscs/smartCheckMapper';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');

// ── the envelope this partner actually uses ───────────────────────────────
{
  const mapper = read('services/cscs/smartCheckMapper.ts');
  ok('responseData is a recognised wrapper', /'responseData',/.test(mapper), 'missing');
  ok('  and it is tried FIRST', /\[\s*\n?\s*'responseData',/.test(mapper), 'not first');

  const inEnvelope = mapSmartCheckResponse(
    { responseData: { status: 'VALID', expiryDate: '2030-01-31', holderName: 'A Zhang', cardType: 'Gold' } },
    'smartcheck',
  );
  ok('a card inside responseData maps', inEnvelope.status === 'VALID', inEnvelope.status);
  ok('  and is marked verified', inEnvelope.verified === true);
  ok('  carrying the holder name', inEnvelope.holderName === 'A Zhang', inEnvelope.holderName);
  ok('  and the expiry', inEnvelope.expiry?.toISOString().slice(0, 10) === '2030-01-31', inEnvelope.expiry);
}

// ── verified is derived from status, never asserted by the payload ────────
{
  // Asserted at BOTH levels. The first version of this fixture only claimed
  // verified inside responseData, so a mapper that trusted a top-level
  // `verified` would have sailed through - the guard and the bug never met.
  const claimsVerified = mapSmartCheckResponse(
    {
      verified: true,
      isValid: true,
      responseData: { status: 'REVOKED', verified: true, isValid: true },
    },
    'smartcheck',
  );
  ok('a payload cannot assert its own trustworthiness', claimsVerified.verified === false, claimsVerified);
  ok('  and the real status survives', claimsVerified.status === 'REVOKED', claimsVerified.status);
  ok('  verified is derived from status alone',
    /verified: status === 'VALID',/.test(read('services/cscs/smartCheckMapper.ts')), 'derivation changed');

  const expired = mapSmartCheckResponse(
    { responseData: { status: 'VALID', expiryDate: '2020-01-01' } },
    'smartcheck',
  );
  ok('a VALID card past its expiry is downgraded to EXPIRED', expired.status === 'EXPIRED', expired.status);
  ok('  and is not verified', expired.verified === false);
}

// ── every mapped field must be PERSISTED ──────────────────────────────────
// A field the mapper produces and the write drops is invisible: the screen
// simply shows nothing and nobody can tell that from "no check ran".
{
  const route = read('app/api/worker/profile/route.ts');
  const write = route.slice(route.indexOf('await upsertWorkerProfile('), route.indexOf('await upsertWorkerProfile(') + 900);
  for (const [field, expr] of [
    ['scheme', 'cscsScheme: verification?.scheme'],
    ['holder name', 'cscsHolderName: verification?.holderName'],
    ['qualifications', 'cscsQualifications: verification?.qualifications'],
    ['status', 'cscsVerificationStatus: verification?.status'],
    ['checked-at', 'cscsVerifiedAt: verification'],
    ['verified flag', 'cscsVerified: verified'],
  ] as [string, string][]) {
    ok(`the ${field} from the check is persisted`, write.includes(expr), expr);
  }
  ok('verified data wins over what the worker typed (card type)',
    /verified && verification\?\.cardType \? verification\.cardType : cscsCardType/.test(route), 'not authoritative');
  ok('  and over the typed expiry',
    /verified && verification\?\.expiry \? verification\.expiry : cscsExpiry/.test(route), 'not authoritative');
  ok('an UNVERIFIED result does NOT overwrite the typed values',
    route.includes('const verified = verification?.verified === true;'), 'guard missing');
}

// ── and DISPLAYED ─────────────────────────────────────────────────────────
{
  const page = read('app/platform/dashboard/workers/[id]/page.tsx');
  ok('the worker screen shows the verification status', /cscsVerificationStatus/.test(page));
  ok('  the scheme the check returned', /worker\.cscsScheme/.test(page));
  ok('  and distinguishes a MOCK result from a real one',
    /verifiedByProvider/.test(page) || /Not a CSCS verification/.test(page), 'mock not distinguished');

  const detail = read('services/workers/workerDetailService.ts');
  for (const f of ['cscsScheme', 'cscsVerified', 'cscsVerificationStatus', 'cscsHolderName', 'cscsQualifications']) {
    ok(`${f} is selected for the screen`, new RegExp(`${f}: true`).test(detail), f);
  }
}

// ── the contract is not claimed confirmed while it is not ─────────────────
{
  const provider = read('services/cscs/smartCheckProvider.ts');
  ok('the card path IS confirmed', /pathConfirmed: true/.test(provider));
  ok('scanType IS confirmed', /scanTypeConfirmed: true/.test(provider));
  // Request field names: the service named two of them, never the third.
  ok('the request field set is still NOT claimed confirmed',
    /fieldsConfirmed: false/.test(provider), 'claimed without evidence');
  const mapper = read('services/cscs/smartCheckMapper.ts');
  ok('the RESPONSE mapper still hedges across names, and says why',
    /alternatives/.test(mapper), 'hedging removed before the shape was confirmed');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
