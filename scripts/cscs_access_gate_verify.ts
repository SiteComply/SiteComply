/**
 * SC-023/SC-001 — CSCS as an ACCESS CONTROL.
 *
 * A non-exempt operative needs a VALID CSCS result to check in to a site where
 * the requirement is enabled. The exempt test account must be unaffected.
 *
 * WHAT MAKES THIS DIFFERENT from the reporting control it replaces: being wrong
 * here turns someone away from their work. Every refusal path is asserted, and
 * so is every path that must NOT refuse.
 */
import { readFileSync } from 'fs';
import { cscsRefusalAction } from '../services/workerAccess/accessRequirements';
import { isCscsExemptMobile } from '../services/cscs/cscsExemptAccounts';
import { mapSmartCheckResponse } from '../services/cscs/smartCheckMapper';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const EXEMPT = '+447700900150';

function withExemption<T>(fn: () => T): T {
  const a = process.env.CSCS_MOCK_MOBILES_ENABLED;
  const b = process.env.CSCS_MOCK_MOBILES;
  process.env.CSCS_MOCK_MOBILES_ENABLED = '1';
  process.env.CSCS_MOCK_MOBILES = EXEMPT;
  try { return fn(); } finally {
    if (a === undefined) delete process.env.CSCS_MOCK_MOBILES_ENABLED; else process.env.CSCS_MOCK_MOBILES_ENABLED = a;
    if (b === undefined) delete process.env.CSCS_MOCK_MOBILES; else process.env.CSCS_MOCK_MOBILES = b;
  }
}

// ── ONLY VALID PASSES ─────────────────────────────────────────────────────
// cscsVerified is derived from `status === 'VALID'`, so the boolean IS the rule.
{
  const card = (over: Record<string, unknown>) => ({
    responseData: {
      cards: [{ customerName: 'A', cardColour: 'Gold', expired: false, cancelled: false, ...over }],
      scheme: { schemeName: 'CSCS' },
    },
  });
  ok('a valid card is verified', mapSmartCheckResponse(card({}) as never, 'x').verified === true);
  for (const [label, over] of [
    ['REVOKED', { cancelled: true }],
    ['EXPIRED', { expired: true }],
    ['flags missing (ERROR)', { expired: undefined, cancelled: undefined }],
  ] as [string, Record<string, unknown>][]) {
    ok(`${label} is NOT verified, so it is refused`,
      mapSmartCheckResponse(card(over) as never, 'x').verified === false);
  }
  ok('NOT_FOUND is not verified',
    mapSmartCheckResponse({ responseData: { cards: [], scheme: {} } } as never, 'x').verified === false);
  ok('UNVERIFIED is not verified',
    mapSmartCheckResponse({ status: 'UNVERIFIED' } as never, 'x').verified === false);

  const src = read('services/cscs/smartCheckMapper.ts');
  ok('verified is derived from status alone, in both mappers',
    (src.match(/verified: status === 'VALID',/g) ?? []).length === 2, src.match(/verified: status === 'VALID',/g));
}

// ── THE REFUSAL SAYS WHICH OUTCOME IT WAS ─────────────────────────────────
{
  ok('REVOKED names the scheme, not an admin',
    /withdrawn by the card scheme/.test(cscsRefusalAction('REVOKED', true)), cscsRefusalAction('REVOKED', true));
  ok('EXPIRED asks for a renewal',
    /Renew it/.test(cscsRefusalAction('EXPIRED', true)), cscsRefusalAction('EXPIRED', true));
  ok('NOT_FOUND points at the details, because it is usually a typo',
    /Check the card number, surname and scheme/.test(cscsRefusalAction('NOT_FOUND', true)));
  ok('ERROR says it is temporary and suggests a retry',
    /Try again/.test(cscsRefusalAction('ERROR', true)), cscsRefusalAction('ERROR', true));
  ok('  and does NOT blame the worker', !/your card is|withdrawn|expired/i.test(cscsRefusalAction('ERROR', true)));
  ok('no card recorded says so', /No CSCS card is recorded/.test(cscsRefusalAction(null, false)));
  ok('a card but no result asks them to complete their details',
    /confirm your surname and card scheme/.test(cscsRefusalAction(null, true)));
  ok('an unrecognised status still produces guidance, never an empty string',
    cscsRefusalAction('SOMETHING_NEW', true).length > 20, cscsRefusalAction('SOMETHING_NEW', true));
  // Every branch must differ - five identical strings would be the old bug.
  const all = ['REVOKED', 'EXPIRED', 'NOT_FOUND', 'ERROR', null].map((s) => cscsRefusalAction(s, true));
  ok('every outcome gets its own words', new Set(all).size === 5, all);
}

// ── THE EXEMPT ACCOUNT IS UNAFFECTED ──────────────────────────────────────
{
  withExemption(() => {
    ok('the exempt mobile is recognised', isCscsExemptMobile(EXEMPT));
    ok('another operative is not', !isCscsExemptMobile('+447700900151'));
  });

  const src = read('services/workerAccess/accessRequirements.ts');
  ok('the evaluator reads the exempt allow-list',
    /const cscsExempt = isCscsExemptMobile\(worker\.mobile\)/.test(src), 'not wired');
  ok('  and the mobile is selected so it can', /mobile: true/.test(src), 'mobile not selected');
  ok('the exempt account skips CSCS_VERIFIED and CSCS_IN_DATE',
    /cscsExempt &&\s*\n?\s*\(requirement === 'CSCS_VERIFIED' \|\| requirement === 'CSCS_IN_DATE'\)/.test(src),
    'skip missing');

  /*
   * NARROW. The exemption must not become a general pass: an exempt account
   * that skipped induction or the knowledge check would be a hole, not a test
   * account.
   */
  const skip = src.slice(src.indexOf('// Only the CSCS requirements are exempted'), src.indexOf('switch (requirement)'));
  for (const other of ['INDUCTION', 'KNOWLEDGE_CHECK_PASSED', 'RAMS', 'PPE']) {
    ok(`  and does NOT skip ${other}`, !skip.includes(other), skip);
  }
  ok('the skip is a continue, not a blanket early return',
    /continue;/.test(skip) && !/return \[\]/.test(skip), skip);
}

// ── THE GATE IS ACTUALLY ENFORCED ON CHECK-IN ─────────────────────────────
{
  const svc = read('services/workerAccess/workerAssignmentService.ts');
  ok('check-in evaluates the requirements', /const unmet = await evaluateRequirements\(workerId, siteId\);/.test(svc));
  ok('  and refuses when any are unmet',
    /if \(unmet\.length > 0\) \{[\s\S]{0,160}allowed: false/.test(svc), 'not enforced');
  ok('  returning the reason, not a bare false', /reason: formatUnmetMessage\(/.test(svc));

  const req = read('services/workerAccess/accessRequirements.ts');
  /*
   * BOUNDED TO THIS ENTRY. A {0,400} window reached into the NEXT requirement's
   * blocksFirstTime, so setting CSCS_VERIFIED's to false still matched - the
   * guard read a different requirement's value and reported success. Stop at the
   * next `requirement:` key.
   */
  ok('CSCS_VERIFIED can block someone who has never inducted here',
    /requirement: 'CSCS_VERIFIED',(?:(?!requirement:)[\s\S])*?blocksFirstTime: true/.test(req),
    'first-timers slip through');
  ok('  and so can CSCS_IN_DATE',
    /requirement: 'CSCS_IN_DATE',(?:(?!requirement:)[\s\S])*?blocksFirstTime: true/.test(req),
    'first-timers slip through');
  ok('the requirement is per-site, from stored configuration',
    /prisma\.siteAccessRequirement\.findMany/.test(req), 'not per-site');
  ok('a site with no requirements enabled blocks nobody',
    /if \(enabled\.length === 0\) return \[\];/.test(req), 'would block everywhere');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
