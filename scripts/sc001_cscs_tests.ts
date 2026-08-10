/**
 * SC-001 — CSCS Smart Check verification pipeline tests.
 *
 * Run: npx tsx scripts/sc001_cscs_tests.ts
 *
 * WHY A SCRIPT AND NOT JEST. The repo has no test runner installed and its
 * established pattern for executable checks is a tsx script (sc025_verify.ts,
 * sc026_verify.ts, ...). Adding a runner would put a dependency tree on a Linux
 * B1 App Service to assert pure functions. The harness below is fifteen lines
 * and runs anywhere tsx does, including CI.
 *
 * WHAT IS COVERED. Everything in the pipeline that does not need the live
 * service: the mapper's full decision table, the mock provider's scenarios, the
 * masking used in the audit trail, and the Smart Check provider's refusal to
 * run unconfigured. The one thing NOT covered is a real response, which is
 * precisely the thing partner access unblocks.
 */
import { CscsCardType } from '@prisma/client';
import {
  mapSmartCheckResponse,
  mapStatus,
  mapCardType,
  parseSmartCheckDate,
  mapQualifications,
  messageForStatus,
} from '../services/cscs/smartCheckMapper';
import { FIXTURES } from '../services/cscs/smartCheckFixtures';
import { MockCscsProvider } from '../services/cscs/mockProvider';
import { SmartCheckCscsProvider } from '../services/cscs/smartCheckProvider';
import { maskCardNumber } from '../services/cscs/cscsVerificationService';
import { CscsVerifyError } from '../services/cscs/CscsProvider';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

async function main() {
  console.log('== SC-001 CSCS Smart Check pipeline ==\n');

  // ---------------------------------------------------------------------
  console.log('[1] Status mapping — fails closed');
  eq('VALID', mapStatus('VALID'), 'VALID');
  eq('lowercase active', mapStatus('active'), 'VALID');
  eq('current', mapStatus('Current'), 'VALID');
  eq('expired', mapStatus('Expired'), 'EXPIRED');
  eq('lapsed', mapStatus('lapsed'), 'EXPIRED');
  eq('withdrawn -> REVOKED', mapStatus('Withdrawn'), 'REVOKED');
  eq('suspended -> REVOKED', mapStatus('suspended'), 'REVOKED');
  eq('no match -> NOT_FOUND', mapStatus('No match found'), 'NOT_FOUND');
  // The one that would be a real defect: "invalid" contains "valid".
  eq('INVALID is not VALID', mapStatus('Invalid card'), 'NOT_FOUND');
  eq('unknown status -> ERROR', mapStatus('PENDING_REVIEW'), 'ERROR');
  eq('empty -> ERROR', mapStatus(''), 'ERROR');
  eq('null -> ERROR', mapStatus(null), 'ERROR');

  // ---------------------------------------------------------------------
  console.log('\n[2] Card grade mapping');
  eq('Blue - Skilled Worker', mapCardType('Blue - Skilled Worker'), CscsCardType.BLUE_SKILLED);
  eq('Black — Manager', mapCardType('Black — Manager'), CscsCardType.BLACK_MANAGER);
  eq('bare Gold', mapCardType('Gold'), CscsCardType.GOLD_SUPERVISORY);
  eq('Advanced Craft -> GOLD', mapCardType('Advanced Craft'), CscsCardType.GOLD_SUPERVISORY);
  eq('Labourer -> GREEN', mapCardType('Labourer'), CscsCardType.GREEN_LABOURER);
  eq('Experienced Worker -> RED', mapCardType('Experienced Worker'), CscsCardType.RED_TRAINEE);
  eq('Professionally Qualified -> WHITE', mapCardType('Professionally Qualified Person'), CscsCardType.WHITE_PROFESSIONAL);
  eq('unrecognised -> null', mapCardType('Purple Wizard'), null);
  eq('empty -> null', mapCardType(''), null);

  // ---------------------------------------------------------------------
  console.log('\n[3] Date parsing — UK order assumed for slash dates');
  eq('ISO', parseSmartCheckDate('2030-03-01')?.toISOString(), '2030-03-01T00:00:00.000Z');
  eq('ISO datetime', parseSmartCheckDate('2030-03-01T12:34:56Z')?.toISOString(), '2030-03-01T00:00:00.000Z');
  // 03/04 is 3 April in the UK. Reading it as 4 March would move an expiry.
  eq('UK DD/MM/YYYY', parseSmartCheckDate('03/04/2027')?.toISOString(), '2027-04-03T00:00:00.000Z');
  eq('UK single digits', parseSmartCheckDate('1/6/2029')?.toISOString(), '2029-06-01T00:00:00.000Z');
  eq('garbage -> null', parseSmartCheckDate('not a date'), null);
  eq('empty -> null', parseSmartCheckDate(''), null);

  // ---------------------------------------------------------------------
  console.log('\n[4] Qualifications');
  eq('objects', mapQualifications([{ title: 'NVQ 2', detail: 'CITB' }]).length, 1);
  eq('plain strings', mapQualifications(['SSSTS', 'Asbestos'])[1]?.title, 'Asbestos');
  eq('untitled entries dropped', mapQualifications([{ detail: 'x' }]).length, 0);
  eq('non-array -> empty', mapQualifications('nope').length, 0);

  // ---------------------------------------------------------------------
  console.log('\n[5] Full payload mapping — fixtures');
  const now = new Date('2026-08-10T00:00:00Z');

  const a = mapSmartCheckResponse(FIXTURES.validSkilledCamel!, 'smartcheck', now);
  eq('camelCase: VALID', a.status, 'VALID');
  eq('camelCase: verified', a.verified, true);
  eq('camelCase: grade', a.cardType, CscsCardType.BLUE_SKILLED);
  eq('camelCase: holder', a.holderName, 'A. Worker');
  eq('camelCase: quals', a.qualifications?.length, 2);

  const b = mapSmartCheckResponse(FIXTURES.validManagerSnakeNested!, 'smartcheck', now);
  eq('snake_case nested: VALID', b.status, 'VALID');
  eq('snake_case nested: grade', b.cardType, CscsCardType.BLACK_MANAGER);
  eq('snake_case nested: UK expiry', b.expiry?.toISOString(), '2029-06-01T00:00:00.000Z');
  eq('snake_case nested: scheme', b.scheme, 'CSCS');

  const c = mapSmartCheckResponse(FIXTURES.validEcsColourOnly!, 'smartcheck', now);
  eq('ECS colour-only grade', c.cardType, CscsCardType.GOLD_SUPERVISORY);
  eq('ECS scheme', c.scheme, 'ECS');

  const d = mapSmartCheckResponse(FIXTURES.expired!, 'smartcheck', now);
  eq('expired: status', d.status, 'EXPIRED');
  eq('expired: not verified', d.verified, false);

  // The important one: the scheme contradicts itself.
  const e = mapSmartCheckResponse(FIXTURES.validButExpiredDate!, 'smartcheck', now);
  eq('VALID + past expiry downgrades', e.status, 'EXPIRED');
  eq('VALID + past expiry not verified', e.verified, false);

  const f = mapSmartCheckResponse(FIXTURES.revoked!, 'smartcheck', now);
  eq('revoked: status', f.status, 'REVOKED');
  eq('revoked: not verified', f.verified, false);

  eq('notFound', mapSmartCheckResponse(FIXTURES.notFound!, 'smartcheck', now).status, 'NOT_FOUND');
  eq('invalid word', mapSmartCheckResponse(FIXTURES.invalidWord!, 'smartcheck', now).status, 'NOT_FOUND');
  eq('unknown status', mapSmartCheckResponse(FIXTURES.unknownStatus!, 'smartcheck', now).status, 'ERROR');
  eq('empty payload', mapSmartCheckResponse(FIXTURES.emptyPayload!, 'smartcheck', now).status, 'ERROR');
  eq('empty payload not verified', mapSmartCheckResponse(FIXTURES.emptyPayload!, 'smartcheck', now).verified, false);

  const g = mapSmartCheckResponse(FIXTURES.qualificationsAsStrings!, 'smartcheck', now);
  eq('string quals mapped', g.qualifications?.length, 2);

  const h = mapSmartCheckResponse(FIXTURES.wrappedInData!, 'smartcheck', now);
  eq('data envelope: VALID', h.status, 'VALID');
  eq('data envelope: grade', h.cardType, CscsCardType.WHITE_PROFESSIONAL);

  // ---------------------------------------------------------------------
  console.log('\n[6] verified is derived from status, never from the payload');
  const spoof = mapSmartCheckResponse(
    { status: 'Expired', verified: true, valid: true } as never,
    'smartcheck',
    now,
  );
  eq('payload cannot assert its own validity', spoof.verified, false);

  // ---------------------------------------------------------------------
  console.log('\n[7] Messages are populated and worker-safe');
  for (const s of ['VALID', 'EXPIRED', 'REVOKED', 'NOT_FOUND', 'ERROR', 'UNVERIFIED'] as const) {
    const m = messageForStatus(s, null);
    check(`${s} has a message`, m.length > 10, m);
    check(`${s} message carries no credential`, !/api|key|token|http/i.test(m), m);
  }

  // ---------------------------------------------------------------------
  console.log('\n[8] Mock provider scenarios');
  const mock = new MockCscsProvider();
  eq('empty -> UNVERIFIED', (await mock.verifyCard({ cardNumber: '' })).status, 'UNVERIFIED');
  eq('0000 -> NOT_FOUND', (await mock.verifyCard({ cardNumber: 'JW00001234' })).status, 'NOT_FOUND');
  eq('REVOKED -> REVOKED', (await mock.verifyCard({ cardNumber: 'REVOKED12' })).status, 'REVOKED');
  const past = await mock.verifyCard({ cardNumber: '12345678', expiryHint: new Date('2000-01-01') });
  eq('past expiry hint -> EXPIRED', past.status, 'EXPIRED');
  const ok = await mock.verifyCard({ cardNumber: '12345678', expiryHint: new Date('2035-01-01') });
  eq('otherwise -> VALID', ok.status, 'VALID');
  eq('VALID is verified', ok.verified, true);
  eq('mock names itself', ok.providerName, 'mock');

  // ---------------------------------------------------------------------
  console.log('\n[9] Smart Check provider refuses to run unconfigured');
  // No credentials: it must THROW rather than fabricate a result. The
  // verification service turns that into a structured ERROR.
  const bare = new SmartCheckCscsProvider({ apiUrl: '', apiKey: '' });
  const savedUrl = process.env.CSCS_SMARTCHECK_API_URL;
  const savedKey = process.env.CSCS_SMARTCHECK_API_KEY;
  delete process.env.CSCS_SMARTCHECK_API_URL;
  delete process.env.CSCS_SMARTCHECK_API_KEY;
  let threw: unknown = null;
  try {
    await bare.verifyCard({ cardNumber: '12345678' });
  } catch (e) {
    threw = e;
  }
  check('unconfigured provider throws', threw instanceof CscsVerifyError, String(threw));
  check(
    'refusal names the setting, not a credential',
    threw instanceof Error && /Integrations/.test(threw.message) && !/key=|token/i.test(threw.message),
    threw instanceof Error ? threw.message : '',
  );
  if (savedUrl !== undefined) process.env.CSCS_SMARTCHECK_API_URL = savedUrl;
  if (savedKey !== undefined) process.env.CSCS_SMARTCHECK_API_KEY = savedKey;

  // ---------------------------------------------------------------------
  console.log('\n[10] Audit masking never stores a full card number');
  eq('masks to last four', maskCardNumber('JW12348201'), '••••8201');
  eq('short number still masked', maskCardNumber('123'), '••••123');
  eq('empty is recorded, not blank', maskCardNumber(''), '(none)');
  check(
    'full number never appears in the mask',
    !maskCardNumber('JW12348201').includes('JW1234'),
    maskCardNumber('JW12348201'),
  );

  // ---------------------------------------------------------------------
  console.log(
    `\n== ${failures.length === 0 ? `VERIFIED — ${passed} assertions passed` : `${failures.length} FAILED of ${passed + failures.length}`} ==`,
  );
  failures.forEach((f) => console.log(`   FAILED: ${f}`));
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
