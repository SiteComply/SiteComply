/**
 * SC-001 — the Test connection gate must not follow the provider dropdown.
 *
 * The bug this pins: the gate read `selected?.supportsTest`, where `selected`
 * tracks the SELECT element. With Mock live and selected — the safe state while
 * the integration is unproven — the button vanished, so the only way to reach it
 * was to pick Smart Check without saving. Undiscoverable, and one stray click
 * from enabling a provider that has never answered a request.
 *
 * Every absence assertion below has a presence partner, because "the string is
 * gone" is also what a typo in the search string looks like.
 */
import { readFileSync } from 'fs';

const SRC = readFileSync('components/admin/CscsProviderSettings.tsx', 'utf8');

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  cond ? pass++ : fail++;
};

// ── the gate ──────────────────────────────────────────────────────────────
ok('the gate no longer reads the dropdown', !SRC.includes('{selected?.supportsTest ?'));
ok('the gate reads the Smart Check descriptor', SRC.includes('{smartCheck?.supportsTest ? ('));
ok(
  'smartCheck is derived from the provider list, not the selection',
  /const smartCheck = config\.providers\.find\(\(p\) => p\.supportsTest\);/.test(SRC),
);
ok(
  'smartCheck does not reference activeProvider',
  !/const smartCheck =[^;]*activeProvider/s.test(SRC),
);

// `selected` must survive — it still drives the provider description, and
// deleting it would be a different bug wearing this fix's clothes.
ok('selected still exists', /const selected = config\.providers\.find/.test(SRC));
ok('selected still renders the description', SRC.includes('{selected.description}'));

// ── the reassurance, and its condition ────────────────────────────────────
ok(
  'the panel says testing does not change the live provider',
  SRC.includes('This does not change which provider is live'),
);
ok(
  'that line is suppressed when Smart Check IS live (it would be false)',
  SRC.includes('{live?.id !== smartCheck?.id ? ('),
);
ok('it names the provider that stays in use', SRC.includes("live?.name ?? 'the current provider'"));

// ── the enable condition matches the two-step protocol ────────────────────
const canTest = SRC.slice(SRC.indexOf('const canTest ='), SRC.indexOf('return (', SRC.indexOf('const canTest =')));
ok('canTest requires the API URL', canTest.includes("apiUrl.trim() !== ''"));
ok('canTest requires a key (typed or stored)', canTest.includes("apiKey.trim() !== '' || config.apiKeySet"));
ok('canTest requires a username', canTest.includes("username.trim() !== ''"));
ok('canTest requires a password (typed or stored)', canTest.includes("password.trim() !== '' || config.passwordSet"));
ok('the hint names all four fields', SRC.includes('Enter the API URL, key, username and password first.'));
ok('the stale two-field hint is gone', !SRC.includes('Enter the API URL and key first.'));

// ── nothing about what is LIVE may have moved ─────────────────────────────
ok(
  'the live banner still reads config.activeProvider, not the dropdown',
  SRC.includes('const live = config.providers.find((p) => p.id === config.activeProvider);'),
);
ok(
  'the dropdown still writes only local state',
  /onChange=\{\(e\) => setActiveProvider\(/.test(SRC),
);
ok('testing still posts to the test route only', SRC.includes("'/api/admin/settings/cscs/test'"));
ok(
  'testConnection does not save',
  !/async function testConnection[\s\S]{0,900}method: 'PUT'/.test(SRC),
);

// ── the mock must still not be testable on its own ────────────────────────
const descriptors = readFileSync('services/cscs/cscsConfigService.ts', 'utf8') +
  readFileSync('services/cscs/CscsProvider.ts', 'utf8');
const mockBlock = descriptors.slice(descriptors.indexOf("id: 'mock'"), descriptors.indexOf("id: 'mock'") + 700);
ok('the mock descriptor still declares supportsTest: false', /supportsTest: false/.test(mockBlock));

// ── the server still refuses an incomplete test ───────────────────────────
const TEST = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
ok(
  'the server still guards on all four credentials',
  TEST.includes('if (!apiUrl || !apiKey || !username || !password)'),
);
ok('a test still writes nothing to CscsVerificationLog', !/CscsVerificationLog|verificationLog\./.test(TEST.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
