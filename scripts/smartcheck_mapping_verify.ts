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
import {
  mapSmartCheckResponse,
  mapStatus,
  mapV26CardResponse,
  statusFromV26Flags,
  isV26CardResponse,
} from '../services/cscs/smartCheckMapper';
import { shapeSummary } from '../services/cscs/smartCheckAuth';

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

// ── the CONFIRMED V2.6 card shape ─────────────────────────────────────────
// Captured from the live service 2026-09-16. The generic mapper below could
// never have read this: there is no status field, the card is inside an array
// two levels down, and there is no expiry date at all.
{
  const card = (over: Record<string, unknown> = {}) => ({
    responseMethod: 'card',
    responseMessage: '',
    responseCode: '200',
    errorCode: '',
    responseData: {
      cards: [
        {
          cardSerial: 'a'.repeat(32),
          customerName: 'Wei Zhang',
          registrationNumber: '14660726',
          customerPhotoType: 'J',
          customerPhoto: 'B'.repeat(3894),
          expired: false,
          cancelled: false,
          cardColour: 'Gold',
          ...over,
        },
      ],
      scheme: { schemeIdentifier: 'C4T', schemeName: 'CSCS' },
    },
  });

  ok('the confirmed shape is recognised', isV26CardResponse(card() as never));
  ok('  and a differently-shaped payload is not', !isV26CardResponse({ status: 'VALID' } as never));

  const good = mapSmartCheckResponse(card() as never, 'smartcheck');
  ok('a live card maps to VALID', good.status === 'VALID', good.status);
  ok('  and is verified', good.verified === true);
  ok('  the holder name comes from customerName', good.holderName === 'Wei Zhang', good.holderName);
  ok('  the card type comes from cardColour', good.cardType === 'GOLD_SUPERVISORY', good.cardType);
  ok('  the scheme comes from scheme.schemeName', good.scheme === 'CSCS', good.scheme);

  // NO EXPIRY EXISTS IN THIS CONTRACT. Null, never a guess - a fabricated date
  // would overwrite the worker's own and read as authoritative.
  ok('no expiry date is invented', good.expiry === null, good.expiry);

  // THE PHOTOGRAPH IS NOT TAKEN. ~4KB of base64 image of a person, which
  // SiteComply did not ask for and has nowhere to put.
  const serialised = JSON.stringify(good);
  ok('the cardholder photo is not carried into the result', !/BBBB/.test(serialised), serialised.slice(0, 120));
  ok('  nor the card serial', !serialised.includes('a'.repeat(32)), serialised.slice(0, 120));

  // Status from the two booleans.
  ok('cancelled -> REVOKED', mapSmartCheckResponse(card({ cancelled: true }) as never, 'x').status === 'REVOKED');
  ok('expired -> EXPIRED', mapSmartCheckResponse(card({ expired: true }) as never, 'x').status === 'EXPIRED');
  ok('cancelled AND expired -> REVOKED (the graver fact)',
    mapSmartCheckResponse(card({ cancelled: true, expired: true }) as never, 'x').status === 'REVOKED');
  for (const s2 of ['REVOKED', 'EXPIRED']) {
    const r = mapSmartCheckResponse(card(s2 === 'REVOKED' ? { cancelled: true } : { expired: true }) as never, 'x');
    ok(`  a ${s2} card is NOT verified`, r.verified === false);
  }

  // FAIL-SAFE ON ABSENCE. Missing flags are a response we do not understand.
  ok('a missing cancelled flag -> ERROR', statusFromV26Flags({ expired: false } as never) === 'ERROR');
  ok('a missing expired flag -> ERROR', statusFromV26Flags({ cancelled: false } as never) === 'ERROR');
  ok('a STRING "false" is not a boolean false',
    statusFromV26Flags({ cancelled: 'false', expired: 'false' } as never) === 'ERROR');
  ok('  so it is never VALID', mapSmartCheckResponse(
    card({ cancelled: 'false', expired: 'false' }) as never, 'x').verified === false);

  // No cards is an ANSWER; several cards is not one we can resolve.
  const none = mapSmartCheckResponse(
    { responseData: { cards: [], scheme: { schemeName: 'CSCS' } } } as never, 'x');
  ok('an empty cards array is NOT_FOUND', none.status === 'NOT_FOUND', none.status);
  ok('  and still reports the scheme', none.scheme === 'CSCS', none.scheme);

  const two = mapSmartCheckResponse({
    responseData: {
      cards: [
        { expired: false, cancelled: false, cardColour: 'Gold', customerName: 'A' },
        { expired: false, cancelled: false, cardColour: 'Blue', customerName: 'B' },
      ],
      scheme: { schemeName: 'CSCS' },
    },
  } as never, 'x');
  ok('two matching cards is ERROR, not a guess', two.status === 'ERROR', two.status);
  ok('  and picks neither', two.cardType === null && two.holderName === null, two);
  ok('  saying why, in words an admin can act on', /more than one card/i.test(two.message), two.message);

  // Every CSCS colour resolves.
  for (const [colour, expected] of [
    ['Green', 'GREEN_LABOURER'], ['Red', 'RED_TRAINEE'], ['Blue', 'BLUE_SKILLED'],
    ['Gold', 'GOLD_SUPERVISORY'], ['Black', 'BLACK_MANAGER'], ['White', 'WHITE_PROFESSIONAL'],
  ] as [string, string][]) {
    ok(`cardColour "${colour}" -> ${expected}`,
      mapV26CardResponse(card({ cardColour: colour }) as never, 'x').cardType === expected,
      mapV26CardResponse(card({ cardColour: colour }) as never, 'x').cardType);
  }
  ok('an unknown colour does not invent a card type',
    mapV26CardResponse(card({ cardColour: 'Turquoise' }) as never, 'x').cardType === null);
}

// ── the status vocabulary: unknown must NEVER become VALID ────────────────
// This is the one mapping where a wrong guess is dangerous rather than merely
// broken: an unrecognised status read as VALID waves a revoked card through a
// site gate.
{
  for (const unknown of [
    'Q', '42', 'card ok', 'GREEN', 'issued',
    '', '   ', 'null', 'undefined',
  ]) {
    const r = mapStatus(unknown);
    ok(`"${unknown}" does not become VALID`, r !== 'VALID', r);
  }
  ok('a non-string status does not become VALID', mapStatus({ a: 1 }) !== 'VALID', mapStatus({ a: 1 }));
  ok('a boolean true does not become VALID', mapStatus(true) !== 'VALID', mapStatus(true));
  ok('null does not become VALID', mapStatus(null) === 'ERROR');

  // ORDERING IS FAIL-SAFE. A status containing both words must resolve to the
  // restrictive reading, and that must not depend on which test runs first.
  ok('"valid - revoked" resolves to REVOKED', mapStatus('valid - revoked') === 'REVOKED', mapStatus('valid - revoked'));
  ok('"active but expired" resolves to EXPIRED', mapStatus('active but expired') === 'EXPIRED', mapStatus('active but expired'));
  ok('"valid: no match" resolves to NOT_FOUND', mapStatus('valid: no match') === 'NOT_FOUND', mapStatus('valid: no match'));
  ok('"invalid" is NOT read as valid', mapStatus('invalid') === 'NOT_FOUND', mapStatus('invalid'));
  ok('"INVALID CARD" is NOT read as valid', mapStatus('INVALID CARD') === 'NOT_FOUND', mapStatus('INVALID CARD'));

  /*
   * NEGATION. "inactive" contains "active", and every one of these mapped to
   * VALID until a test asked. This is the most dangerous mistake the mapper can
   * make - a card the scheme has switched off, read as good, at a site gate.
   */
  for (const negated of [
    'inactive', 'INACTIVE', 'Not Active', 'not valid', 'never valid',
    'valid - on hold', 'provisional active', 'awaiting review - active',
    'no longer valid',
  ]) {
    ok(`"${negated}" is NEVER VALID`, mapStatus(negated) !== 'VALID', mapStatus(negated));
  }
  // And the genuinely good words still pass, so the guard above is not simply
  // "nothing is ever valid".
  ok('a suspended-but-active card is REVOKED, not ERROR',
    mapStatus('active (suspended)') === 'REVOKED', mapStatus('active (suspended)'));

  // The words that SHOULD pass, so the guard above is not just "nothing works".
  for (const good of ['VALID', 'Valid', 'ACTIVE', 'current']) {
    ok(`"${good}" maps to VALID`, mapStatus(good) === 'VALID', mapStatus(good));
  }
}

// ── the diagnostic must reveal the vocabulary, not the cardholder ─────────
{
  const sample = shapeSummary({
    responseData: {
      cardStatus: 'Active', cardType: 'Gold', scheme: 'CSCS', expiryDate: '2028-03-31',
      holderName: 'Wei Zhang', registrationNumber: '14660726',
    },
  });
  ok('the card status value is shown - it is what the mapper must recognise',
    /cardStatus: "Active"/.test(sample), sample);
  ok('  as is the card type', /cardType: "Gold"/.test(sample), sample);
  ok('  and the scheme', /scheme: "CSCS"/.test(sample), sample);
  ok('the cardholder name is NOT shown', !/Wei Zhang/.test(sample), sample);
  ok('  nor the card number', !/14660726/.test(sample), sample);
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
