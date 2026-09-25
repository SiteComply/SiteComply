export {};
/**
 * The ECS card shape, and why an ECS lookup reported a service failure.
 *
 * WHAT ACTUALLY HAPPENED, from the production log and one live probe:
 *
 *   The request reached Smart Check, authenticated, and returned HTTP 200 with a
 *   card. The scheme identifier "ECS" was accepted and resolved to the
 *   Electrotechnical Certification Scheme. One card came back, and it was VALID.
 *
 *   But an ECS card carries `isValid` + `dateOfExpiry` + `cardTypeName`, where the
 *   CSCS card confirmed in September carries `expired` + `cancelled` + `cardColour`.
 *   statusFromV26Flags required two booleans that an ECS card does not have, and
 *   fails safe to ERROR - which surfaced as "the service could not complete this
 *   check" on a card the service had just confirmed.
 *
 * THE FIXTURES BELOW ARE THE REAL PAYLOADS, keys and types exactly as observed.
 * The whole bug was an assumed shape, so a test written from an assumed shape
 * would prove nothing.
 *
 * Run: npx tsx scripts/cscs_ecs_shape_verify.ts
 */
const {
  mapSmartCheckResponse,
  statusFromV26Flags,
  expiryFromV26Card,
  cardTypeFromV26Card,
  isV26CardResponse,
  describeCards,
} = require('../services/cscs/smartCheckMapper');
const { CSCS_SCHEMES, schemeById } = require('../services/cscs/schemes');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

/** Ryan's card, exactly as the live service returned it on 2026-09-25. */
const ECS_LIVE = {
  responseMethod: 'card',
  responseMessage: '',
  responseCode: '200',
  errorCode: '',
  responseData: {
    cards: [
      {
        cardSerial: '00000000007633',
        customerName: 'R. Tester',
        registrationNumber: '00000000007633',
        customerPhotoType: '2',
        customerPhoto: 'BASE64…',
        cardTypeName: 'Craft',
        dateOfExpiry: '2028-09-05',
        isValid: true,
        cardDesignName: 'Craft',
        qualificationType: '1',
        isNonCscsCard: false,
        occupationQualifications: [{}, {}, {}, {}, {}, {}, {}, {}, {}],
      },
    ],
    scheme: {
      schemeIdentifier: 'ECS',
      schemeName: 'Electrotechnical Certification Scheme',
    },
  },
};

/** The CSCS shape, which must keep working exactly as it did. */
const CSCS_LIVE = {
  responseMethod: 'card',
  responseCode: '200',
  responseData: {
    cards: [
      {
        cardSerial: '14660726',
        customerName: 'A. Zhang',
        registrationNumber: '14660726',
        expired: false,
        cancelled: false,
        cardColour: 'Blue',
      },
    ],
    scheme: { schemeIdentifier: 'C4T', schemeName: 'CSCS' },
  },
};

const AT = new Date('2026-09-25T09:00:00Z');

console.log('\nTHE SCHEME IDENTIFIER WAS NEVER THE PROBLEM');
chk('ECS (JIB) is offered as "ECS"', schemeById('ECS')?.name === 'ECS (JIB)');
chk('and the live service resolved it',
  ECS_LIVE.responseData.scheme.schemeIdentifier === 'ECS' &&
  ECS_LIVE.responseData.scheme.schemeName === 'Electrotechnical Certification Scheme',
  'the id was accepted; nothing about the mapping or the payload was wrong');

console.log('\nRYAN’S CARD NOW VERIFIES');
const ecs = mapSmartCheckResponse(ECS_LIVE, 'smartcheck', AT);
chk('the payload is recognised as the card shape', isV26CardResponse(ECS_LIVE) === true);
chk('status is VALID, not ERROR', ecs.status === 'VALID', ecs.status);
chk('  and it is recorded as verified', ecs.verified === true);
chk('the scheme is named', ecs.scheme === 'Electrotechnical Certification Scheme');
chk('the expiry the scheme stated is recorded',
  ecs.expiry instanceof Date && ecs.expiry.toISOString().slice(0, 10) === '2028-09-05',
  String(ecs.expiry));
chk('  and the message tells the operative until when',
  /2028/.test(ecs.message), ecs.message);
/*
 * NULL, AND THAT IS THE RIGHT ANSWER TODAY. mapCardType reads CSCS's vocabulary -
 * colours and role words - and "Craft" is ECS's own grade name, matching none of
 * them. Deciding that an ECS Craft card "is" a CSCS Blue Skilled card is a
 * cross-scheme equivalence nobody here is qualified to assert, and cardType is
 * display-only: it grants access nowhere. Null leaves the operative's own declared
 * type standing, which is the documented fallback. Worth asking the schemes about;
 * not worth guessing.
 */
chk('the card type is left null rather than guessed from ECS’s own grade name',
  ecs.cardType === null,
  'verification does not depend on it, and a wrong grade shown against a name is worse than none');
chk('the holder is recorded', ecs.holderName === 'R. Tester');
chk('qualifications are NOT invented from occupationQualifications',
  Array.isArray(ecs.qualifications) && ecs.qualifications.length === 0,
  'the entry shape is unconfirmed; crediting a qualification on a guess is worse than omitting it');

console.log('\nTHE OLD BEHAVIOUR, FOR CONTRAST');
const withoutIsValid = {
  ...ECS_LIVE,
  responseData: {
    ...ECS_LIVE.responseData,
    cards: [{ ...ECS_LIVE.responseData.cards[0], isValid: undefined }],
  },
};
chk('a card with neither shape’s standing is still ERROR',
  mapSmartCheckResponse(withoutIsValid, 'smartcheck', AT).status === 'ERROR',
  'the fail-safe is kept: unreadable is never VALID');

console.log('\nTHE CSCS SHAPE IS UNTOUCHED');
const cscs = mapSmartCheckResponse(CSCS_LIVE, 'smartcheck', AT);
chk('a current CSCS card is still VALID', cscs.status === 'VALID');
chk('  and still records no expiry, because CSCS gives none',
  cscs.expiry === null, String(cscs.expiry));
chk('  and still reads its colour', cscs.cardType !== null);
chk('cancelled still outranks expired',
  statusFromV26Flags({ cancelled: true, expired: true }, AT) === 'REVOKED');
chk('expired is still EXPIRED',
  statusFromV26Flags({ cancelled: false, expired: true }, AT) === 'EXPIRED');

console.log('\nWHAT isValid: false MEANS');
chk('not valid, expiry already passed -> EXPIRED',
  statusFromV26Flags({ isValid: false, dateOfExpiry: '2020-01-01' }, AT) === 'EXPIRED',
  'tell them to renew it');
chk('not valid, expiry still ahead -> REVOKED',
  statusFromV26Flags({ isValid: false, dateOfExpiry: '2030-01-01' }, AT) === 'REVOKED',
  'not valid for a reason that is not the date: contact the scheme');
chk('not valid, no date at all -> REVOKED',
  statusFromV26Flags({ isValid: false }, AT) === 'REVOKED');
chk('valid but the date has passed is downgraded',
  mapSmartCheckResponse(
    { responseData: { cards: [{ isValid: true, dateOfExpiry: '2020-01-01',
        customerName: 'X' }], scheme: {} } },
    'smartcheck', AT,
  ).status === 'EXPIRED',
  'a scheme calling a lapsed card valid does not make a verified record');

console.log('\nPRECEDENCE AND THE MIXED CASE');
chk('when BOTH shapes are present the CSCS booleans win',
  statusFromV26Flags({ cancelled: true, expired: false, isValid: true }, AT) === 'REVOKED',
  'the longest-confirmed contract decides, not whichever field is read first');

console.log('\nSEVERAL CARDS, MIXED SHAPES');
const mixed = {
  responseData: {
    cards: [
      { isValid: false, dateOfExpiry: '2020-01-01', customerName: 'R. Tester', cardTypeName: 'Craft' },
      { isValid: true, dateOfExpiry: '2029-01-01', customerName: 'R. Tester', cardTypeName: 'Craft' },
    ],
    scheme: { schemeName: 'Electrotechnical Certification Scheme' },
  },
};
const m = mapSmartCheckResponse(mixed, 'smartcheck', AT);
chk('a lapsed card beside a current one is VALID', m.status === 'VALID', m.status);
chk('  and the expiry recorded is the CURRENT card’s',
  m.expiry?.toISOString().slice(0, 10) === '2029-01-01', String(m.expiry));
chk('  and the audit note describes both',
  /2 cards returned/.test(m.note ?? '') && /Craft/.test(m.note ?? ''), m.note);
/*
 * TWO CURRENT CARDS, DIFFERENT DATES. This is the case that distinguishes "the
 * latest expiry" from "the first one in the array" - the mixed set above has only
 * one current card, so both rules give the same answer there and a mutation
 * swapping them survived.
 */
const twoCurrent = mapSmartCheckResponse(
  {
    responseData: {
      cards: [
        { isValid: true, dateOfExpiry: '2027-03-01', customerName: 'R. Tester' },
        { isValid: true, dateOfExpiry: '2030-11-30', customerName: 'R. Tester' },
      ],
      scheme: { schemeName: 'Electrotechnical Certification Scheme' },
    },
  },
  'smartcheck',
  AT,
);
chk('with two current cards the LATEST expiry is recorded',
  twoCurrent.status === 'VALID' &&
    twoCurrent.expiry?.toISOString().slice(0, 10) === '2030-11-30',
  `${twoCurrent.status} ${String(twoCurrent.expiry)} — the set is current until the newer card lapses`);

chk('describeCards names an ECS card by its type',
  /Craft/.test(describeCards([{ isValid: true, cardTypeName: 'Craft' }])));

console.log('\nHELPERS READ WHAT IS THERE');
chk('the expiry is read from dateOfExpiry',
  expiryFromV26Card({ dateOfExpiry: '2028-09-05' })?.toISOString().slice(0, 10) === '2028-09-05');
chk('a CSCS card has no date to read',
  expiryFromV26Card({ expired: false, cancelled: false }) === null);
chk('the type falls back through colour, then name, then design',
  cardTypeFromV26Card({ cardColour: 'Blue' }) !== null &&
  // A name mapCardType DOES know, to prove the fallback is wired rather than dead.
  cardTypeFromV26Card({ cardTypeName: 'Skilled Worker' }) !== null &&
  cardTypeFromV26Card({ cardDesignName: 'Supervisor' }) !== null);
chk('  but an unknown grade name yields null, not a guess',
  cardTypeFromV26Card({ cardTypeName: 'Craft' }) === null);
chk('a card with none of them yields no type',
  cardTypeFromV26Card({ isValid: true }) === null,
  'null, not a guessed grade');

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
