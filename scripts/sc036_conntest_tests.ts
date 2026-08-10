/**
 * SC-036 — CSCS Smart Check connection test coverage.
 *
 * Covers every branch of the verdict, plus the guards that run before any
 * socket is opened. Run: npx tsx scripts/sc036_conntest_tests.ts
 *
 * No network is required except the two deliberately-unresolvable hosts, which
 * use the RFC 6761 `.invalid`/`.test` reserved TLDs precisely so they can never
 * accidentally reach a real service.
 */
import {
  classifySmartCheckResponse,
  testSmartCheckConnection,
} from '../services/cscs/smartCheckConnectionTest';

let fails = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
}

const H = 'api.example.co.uk';

console.log('\n[1] Response classification');

const ok200 = classifySmartCheckResponse(200, '{"status":"NOT_FOUND"}', H);
check('200 + JSON → OK / success', ok200.outcome === 'OK' && ok200.ok && ok200.severity === 'success', ok200.outcome);
check(
  '200 does NOT claim the card contract is confirmed',
  !/verified|confirmed integration/i.test(ok200.title) && /Confirm the card fields/i.test(ok200.detail),
);

const html = classifySmartCheckResponse(200, '<html>hello</html>', H);
check('200 + non-JSON → UNREADABLE_RESPONSE / warning', html.outcome === 'UNREADABLE_RESPONSE' && html.severity === 'warning', html.outcome);
check('unreadable is not ok', !html.ok);

const empty = classifySmartCheckResponse(204, '', H);
check('2xx + empty body → UNREADABLE_RESPONSE', empty.outcome === 'UNREADABLE_RESPONSE', empty.outcome);

// A JSON array is `typeof 'object'` but is not the object the mapper expects.
const arr = classifySmartCheckResponse(200, '[1,2,3]', H);
check('200 + JSON array → still treated as an object answer', arr.outcome === 'OK', arr.outcome);

for (const s of [401, 403]) {
  const r = classifySmartCheckResponse(s, '', H);
  check(`${s} → UNAUTHORISED / error`, r.outcome === 'UNAUTHORISED' && r.severity === 'error' && !r.ok, r.outcome);
}

const nf = classifySmartCheckResponse(404, '', H);
check('404 → CARD_NOT_FOUND', nf.outcome === 'CARD_NOT_FOUND', nf.outcome);
check('404 is a WARNING, not a pass and not a failure', nf.severity === 'warning' && !nf.ok, `${nf.severity}/ok=${nf.ok}`);
check('404 states both readings', /matched no record/i.test(nf.detail) && /not the one CSCS publish/i.test(nf.detail));

const rl = classifySmartCheckResponse(429, '', H);
check('429 → RATE_LIMITED / warning', rl.outcome === 'RATE_LIMITED' && rl.severity === 'warning', rl.outcome);

const br = classifySmartCheckResponse(400, '', H);
check('400 → REQUEST_REJECTED / error', br.outcome === 'REQUEST_REJECTED' && r0(br), br.outcome);
const teapot = classifySmartCheckResponse(418, '', H);
check('other 4xx → REQUEST_REJECTED', teapot.outcome === 'REQUEST_REJECTED', teapot.outcome);
check('4xx points at the contract, not the credentials', /request format differs/i.test(br.detail));

for (const s of [500, 502, 503]) {
  const r = classifySmartCheckResponse(s, '', H);
  check(`${s} → SERVICE_ERROR / error`, r.outcome === 'SERVICE_ERROR' && r0(r), r.outcome);
}

// Ordering matters: 429 must not be swallowed by the generic >= 400 branch,
// and 404 must not be swallowed either.
check('429 is not classified as REQUEST_REJECTED', rl.outcome !== 'REQUEST_REJECTED');
check('404 is not classified as REQUEST_REJECTED', nf.outcome !== 'REQUEST_REJECTED');

console.log('\n[2] No verdict leaks a credential');
const SECRET = 'sk-live-SUPERSECRET-abc123';
const all = [ok200, html, empty, arr, nf, rl, br, teapot, classifySmartCheckResponse(500, SECRET, H)];
check(
  'no title or detail echoes a response body or key',
  all.every((r) => !r.title.includes(SECRET) && !r.detail.includes(SECRET)),
);
check(
  'a 5xx body is never echoed back to the screen',
  !classifySmartCheckResponse(500, SECRET, H).detail.includes('SUPERSECRET'),
);

console.log('\n[3] Pre-flight guards (no request is made)');

(async () => {
  const noCreds = await testSmartCheckConnection({ apiUrl: '', apiKey: '' });
  check('missing both → NOT_CONFIGURED', noCreds.outcome === 'NOT_CONFIGURED', noCreds.outcome);
  const noKey = await testSmartCheckConnection({ apiUrl: 'https://api.example.co.uk', apiKey: '' });
  check('missing key → NOT_CONFIGURED', noKey.outcome === 'NOT_CONFIGURED', noKey.outcome);
  const noUrl = await testSmartCheckConnection({ apiUrl: '', apiKey: 'k' });
  check('missing url → NOT_CONFIGURED', noUrl.outcome === 'NOT_CONFIGURED', noUrl.outcome);

  const http = await testSmartCheckConnection({ apiUrl: 'http://api.example.co.uk', apiKey: 'k' });
  check('http:// refused', http.outcome === 'BLOCKED_URL' && /https/i.test(http.title), http.outcome);

  const junk = await testSmartCheckConnection({ apiUrl: 'not a url', apiKey: 'k' });
  check('malformed url refused', junk.outcome === 'BLOCKED_URL', junk.outcome);

  const blocked = [
    'https://localhost',
    'https://127.0.0.1',
    'https://10.1.2.3',
    'https://192.168.0.5',
    'https://172.16.4.4',
    'https://172.31.255.1',
    'https://169.254.169.254', // cloud metadata
    'https://something.internal',
  ];
  for (const u of blocked) {
    const r = await testSmartCheckConnection({ apiUrl: u, apiKey: 'k' });
    check(`SSRF guard blocks ${u}`, r.outcome === 'BLOCKED_URL', r.outcome);
  }

  // Public addresses in the same shape must NOT be blocked — a guard that
  // refuses everything would silently make the button useless.
  const allowedShape = await testSmartCheckConnection({
    apiUrl: 'https://172.32.0.1',
    apiKey: 'k',
  });
  check(
    '172.32.x is public and is NOT blocked (guard is not over-broad)',
    allowedShape.outcome !== 'BLOCKED_URL',
    allowedShape.outcome,
  );

  console.log('\n[4] Unreachable host');
  const dead = await testSmartCheckConnection({
    apiUrl: 'https://cscs-connection-test.invalid',
    apiKey: 'k',
  });
  check('non-resolving host → UNREACHABLE / error', dead.outcome === 'UNREACHABLE' && !dead.ok, dead.outcome);
  check('names the host so the admin can see the typo', dead.title.includes('cscs-connection-test.invalid'), dead.title);
  check('does not echo the API key', !dead.title.includes('k=') && !JSON.stringify(dead).includes('"k"'));
  check('reports a duration', typeof dead.durationMs === 'number' && dead.durationMs >= 0);

  console.log(`\n== ${fails === 0 ? 'ALL PASSED' : `${fails} FAILED`} ==`);
  process.exit(fails === 0 ? 0 : 1);
})();

function r0(r: { severity: string; ok: boolean }) {
  return r.severity === 'error' && !r.ok;
}
