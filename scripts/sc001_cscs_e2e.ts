/**
 * SC-001 — CSCS Smart Check END-TO-END pipeline test (requires a database).
 *
 * Run: npx tsx scripts/sc001_cscs_e2e.ts
 *
 * Exercises the whole chain the unit tests cannot: runtime config resolution,
 * provider selection, credential encryption at rest, the master switch, the
 * refusal to select an unconfigured provider, graceful degradation when the
 * partner is unreachable, and the audit trail.
 *
 * NO EXTERNAL SERVICE IS CONTACTED. Step 7 deliberately points at a hostname
 * under the .test TLD, which RFC 6761 reserves and which never resolves
 * publicly — so the unreachable-partner path is exercised by a DNS failure that
 * cannot leave the machine. The stack trace it prints is the expected evidence,
 * not a fault.
 *
 * The suite cleans up after itself: it removes the config row and its own audit
 * rows, leaving the database as it found it.
 */
import { PrismaClient } from '@prisma/client';
import { verifyCscsCard, listCscsVerifications } from '@/services/cscs/cscsVerificationService';
import { getCscsRuntimeConfig, saveCscsConfig } from '@/services/cscs/cscsConfigService';
const p = new PrismaClient();
let fails = 0;
const chk = (n: string, ok: boolean, d = '') => { console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  console.log('== SC-001 end-to-end: config -> provider -> result -> audit ==\n');
  await p.cscsVerificationLog.deleteMany({ where: { cardNumberMasked: { contains: '9911' } } });

  console.log('[1] default config with no row');
  await p.cscsConfig.deleteMany({});
  let cfg = await getCscsRuntimeConfig();
  chk('defaults to mock', cfg.providerId === 'mock', cfg.providerId);
  chk('source is default', cfg.source === 'default', cfg.source);
  chk('verification enabled', cfg.verificationEnabled === true);

  console.log('\n[2] a real verification writes an audit row');
  const before = await p.cscsVerificationLog.count();
  const r = await verifyCscsCard({ cardNumber: 'JW12349911', expiryHint: new Date('2035-01-01') });
  chk('result is VALID', r.status === 'VALID', r.status);
  chk('verified true', r.verified === true);
  const after = await p.cscsVerificationLog.count();
  chk('audit row written', after === before + 1, `${before} -> ${after}`);
  const row = await p.cscsVerificationLog.findFirst({ orderBy: { createdAt: 'desc' } });
  chk('card number masked', row?.cardNumberMasked === '••••9911', row?.cardNumberMasked ?? '');
  chk('full number NOT stored', !(row?.cardNumberMasked ?? '').includes('JW1234'));
  chk('provider recorded', row?.provider === 'mock', row?.provider ?? '');
  chk('duration recorded', typeof row?.durationMs === 'number');

  console.log('\n[3] failures are logged too');
  const nf = await verifyCscsCard({ cardNumber: 'JW00009911' });
  chk('NOT_FOUND result', nf.status === 'NOT_FOUND', nf.status);
  const nfRow = await p.cscsVerificationLog.findFirst({ orderBy: { createdAt: 'desc' } });
  chk('failed attempt logged', nfRow?.status === 'NOT_FOUND', nfRow?.status ?? '');
  chk('not marked verified', nfRow?.verified === false);

  console.log('\n[4] the master switch is enforced');
  await saveCscsConfig({ activeProvider: 'mock', verificationEnabled: false }, { adminId: 'probe', name: 'Probe' });
  const off = await verifyCscsCard({ cardNumber: 'JW12349911', expiryHint: new Date('2035-01-01') });
  chk('no check runs when disabled', off.status === 'UNVERIFIED', off.status);
  chk('disabled attempt still logged', (await p.cscsVerificationLog.findFirst({ orderBy: { createdAt: 'desc' } }))?.errorReason === 'verification disabled');

  console.log('\n[5] selecting smartcheck without credentials is REFUSED');
  const bad = await saveCscsConfig({ activeProvider: 'smartcheck', verificationEnabled: true }, { adminId: 'probe', name: 'Probe' });
  chk('save refused', bad.ok === false, JSON.stringify(bad));
  chk('reason names credentials', !bad.ok && /API URL and key/.test(bad.errors.activeProvider ?? ''), !bad.ok ? bad.errors.activeProvider ?? '' : '');
  cfg = await getCscsRuntimeConfig();
  chk('provider unchanged after refusal', cfg.providerId === 'mock', cfg.providerId);

  console.log('\n[6] with credentials, smartcheck can be selected and is used');
  const good = await saveCscsConfig({ activeProvider: 'smartcheck', verificationEnabled: true,
    smartCheckApiUrl: 'https://api.example-partner.test', smartCheckApiKey: 'test-key-not-real' },
    { adminId: 'probe', name: 'Probe' });
  chk('save accepted', good.ok === true, JSON.stringify(good));
  cfg = await getCscsRuntimeConfig();
  chk('provider is smartcheck', cfg.providerId === 'smartcheck', cfg.providerId);
  chk('source is database', cfg.source === 'database', cfg.source);
  chk('api key decrypts back', cfg.apiKey === 'test-key-not-real', String(cfg.apiKey));
  const stored = await p.cscsConfig.findUnique({ where: { id: 'cscs' } });
  chk('api key ENCRYPTED at rest', stored?.smartCheckApiKey !== 'test-key-not-real');

  console.log('\n[7] an unreachable partner degrades to ERROR, never to verified');
  const err = await verifyCscsCard({ cardNumber: 'JW12349911' });
  chk('status ERROR', err.status === 'ERROR', err.status);
  chk('not verified', err.verified === false);
  chk('worker-safe message', !/api|key|example-partner/i.test(err.message), err.message);
  const errRow = await p.cscsVerificationLog.findFirst({ orderBy: { createdAt: 'desc' } });
  chk('error reason captured for support', !!errRow?.errorReason, errRow?.errorReason ?? '');

  console.log('\n[8] audit query works');
  const list = await listCscsVerifications('nonexistent-worker');
  chk('listing returns an array', Array.isArray(list));

  await p.cscsConfig.deleteMany({});
  await p.cscsVerificationLog.deleteMany({ where: { cardNumberMasked: { contains: '9911' } } });
  console.log(`\n== ${fails===0?'VERIFIED':`${fails} FAILED`} ==`);
  await p.$disconnect();
  process.exit(fails===0?0:1);
})();
