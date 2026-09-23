/**
 * "My scheme is not listed" — an honest answer for a card SiteComply cannot ask
 * about.
 *
 * THE DEFECT: the scheme list holds 17 of the 38 CSCS Alliance schemes, and a
 * scheme became compulsory once a card number was entered - while the help text
 * still said to leave it blank. A holder of one of the other 21 (ECS among them)
 * could only name a scheme that did not issue their card. Smart Check then
 * answered "no matching card", and at a gate they were told to check their
 * number, surname and scheme: a valid card reported as a bad one.
 *
 * Run: npx tsx scripts/cscs_scheme_notlisted_verify.ts
 */
import { readFileSync } from 'fs';
import {
  CSCS_SCHEMES,
  SCHEME_NOT_LISTED,
  isKnownScheme,
  isSchemeNotListed,
} from '../services/cscs/schemes';
import { cscsRefusalAction } from '../services/workerAccess/accessRequirements';
import { needsCscsRemediation } from '../services/cscs/cscsRemediation';

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

async function main() {
  console.log('== CARD SCHEME NOT LISTED ==\n');

  console.log('[1] The answer itself');
  ok('"not listed" is recognised', isSchemeNotListed(SCHEME_NOT_LISTED) && isSchemeNotListed('not_listed'));
  ok('  and is NOT a scheme that can be looked up', !isKnownScheme(SCHEME_NOT_LISTED));
  ok('  it collides with no real scheme id', !CSCS_SCHEMES.some((s) => s.id === SCHEME_NOT_LISTED));
  ok('blank is still not an answer', !isSchemeNotListed('') && !isSchemeNotListed(null) && !isSchemeNotListed(undefined));

  console.log('\n[2] The form offers it, and says so');
  const form = read('components/checkin/IdentityForm.tsx');
  ok('the picker offers "My scheme is not listed"', /value=\{SCHEME_NOT_LISTED\}>\s*\n?\s*My scheme is not listed/.test(form));
  ok('  only while the list is known to be incomplete',
    /!SCHEME_LIST_EXHAUSTIVE && \(\s*\n?\s*<option value=\{SCHEME_NOT_LISTED\}/.test(form));
  ok('the help text no longer tells them to leave it blank - which the server refuses',
    !/leave this blank/.test(form) && /choose “My scheme is not listed”/.test(form), 'stale instruction');

  ok('a recorded-but-unchecked card is not shown to the operative as an error',
    /v\.status === 'UNVERIFIED'[\s\S]{0,400}toast\.success/.test(form), 'still danger-red');
  ok('  and the form does not promise a check it cannot make',
    /form\.cscsSchemeId === SCHEME_NOT_LISTED[\s\S]{0,200}cannot check this scheme automatically/.test(form));

  console.log('\n[3] The save path accepts it, stores no scheme, and asks CSCS nothing');
  const route = read('app/api/worker/profile/route.ts');
  ok('the route accepts a known scheme OR "not listed"',
    /if \(!isKnownScheme\(fields\.cscsSchemeId\) && !schemeNotListed\)/.test(route));
  ok('  but still refuses a blank answer when a card is given',
    /if \(fields\.cscsCardNumber\.trim\(\)\) \{/.test(route));
  ok('  the answer IS stored, so "not listed" stays distinct from "not answered"',
    /\? SCHEME_NOT_LISTED/.test(route));
  ok('  but it is never sent to Smart Check',
    /schemeId: isKnownScheme\(schemeId\) \? schemeId : null,/.test(route));
  const checkNow = read('app/api/platform/workers/[id]/cscs-check/route.ts');
  ok('  and "Check this card now" treats it as no scheme, not as one to look up',
    /isKnownScheme\(worker\.cscsSchemeId\) \? null : 'card scheme'/.test(checkNow));
  const wpage = read('app/platform/dashboard/workers/[id]/page.tsx');
  ok('  the operative record shows the answer, not the raw sentinel',
    /isSchemeNotListed\(worker\.cscsSchemeId\)\s*\n?\s*\? 'Not listed/.test(wpage));
  ok('  and tells the manager to confirm the physical card',
    /confirm the physical card instead/.test(wpage));
  ok('  and the verification is told no lookup is possible', /schemeNotListed,/.test(route));

  // The real service, against the real local database: no provider is reached.
  const { prisma } = require('../lib/prisma');
  const { verifyCscsCard } = require('../services/cscs/cscsVerificationService');
  const before = await prisma.cscsVerificationLog.count();
  const result = await verifyCscsCard({
    cardNumber: 'ECS1027633', surname: 'Schubert', schemeId: null, schemeNotListed: true,
    providerOverride: { name: 'must-not-run', verifyCard: async () => { throw new Error('the provider was called'); } },
  });
  ok('the card is recorded UNVERIFIED, not refused and not errored',
    result.status === 'UNVERIFIED' && result.verified === false, result.status);
  // CONTROL: the same throwing provider WITHOUT the flag is reached, and the
  // failure surfaces as ERROR. So the flag is what skips the lookup, not the
  // stub quietly doing nothing.
  const control = await verifyCscsCard({
    cardNumber: 'ECS1027633', surname: 'Schubert', schemeId: 'C4T',
    providerOverride: { name: 'must-not-run', verifyCard: async () => { throw new Error('the provider was called'); } },
  });
  ok('  the provider is never called - the same stub DOES run without the flag',
    control.status === 'ERROR', control.status);
  ok('  the operative is told why, and who will confirm it',
    /not one we can check automatically/.test(result.message) && /site manager/.test(result.message), result.message);
  ok('  it is not reported as a service failure', !/could not complete/.test(result.message));
  const rows = await prisma.cscsVerificationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 2 });
  ok('the attempt is still audited, with the reason',
    (await prisma.cscsVerificationLog.count()) === before + 2 &&
    rows[1].status === 'UNVERIFIED' && /scheme not listed/.test(rows[1].errorReason ?? ''), rows[1]?.errorReason);
  ok('  and records no scheme', rows[1].scheme === null);
  await prisma.cscsVerificationLog.deleteMany({ where: { id: { in: rows.map((r: { id: string }) => r.id) } } });
  await prisma.$disconnect();

  console.log('\n[4] At the gate, and in the prompt');
  ok('an unverified card whose scheme cannot be looked up points at the site manager',
    /ask your site manager/i.test(cscsRefusalAction('UNVERIFIED', true, false)), cscsRefusalAction('UNVERIFIED', true, false));
  ok('  and does NOT send them back to a field with no right answer',
    !/confirm your surname and card scheme/i.test(cscsRefusalAction('UNVERIFIED', true, false)));
  ok('an unverified card WITH a scheme still asks them to check their details',
    /confirm your surname and card scheme/i.test(cscsRefusalAction('UNVERIFIED', true, true)));
  ok('no card at all is unchanged', /No CSCS card is recorded/.test(cscsRefusalAction('UNVERIFIED', false, true)));
  ok('a NOT_FOUND card is unchanged', /No matching card was found/.test(cscsRefusalAction('NOT_FOUND', true, false)));

  process.env.CSCS_REMEDIATION_ENABLED = '1';
  ok('the prompt does not badger someone who said their scheme is not listed',
    needsCscsRemediation({ mobile: '+447700900001', cscsCardNumber: 'ECS1027633', cscsSchemeId: SCHEME_NOT_LISTED, cscsVerificationStatus: 'UNVERIFIED' }) === false);
  ok('  but an operative who has simply NOT ANSWERED yet is still prompted - that one they can fix',
    needsCscsRemediation({ mobile: '+447700900001', cscsCardNumber: '12345678', cscsSchemeId: null, cscsVerificationStatus: 'UNVERIFIED' }) === true);
  ok('  but still prompts an unverified card that CAN be checked',
    needsCscsRemediation({ mobile: '+447700900001', cscsCardNumber: '12345678', cscsSchemeId: 'C4T', cscsVerificationStatus: 'UNVERIFIED' }) === true);
  ok('  and still prompts an expired one', 
    needsCscsRemediation({ mobile: '+447700900001', cscsCardNumber: '12345678', cscsSchemeId: 'C4T', cscsVerificationStatus: 'EXPIRED' }) === true);

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
