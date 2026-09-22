/**
 * The RESOLVED provider - the one an operative's own card check uses - must
 * carry all four Smart Check credentials.
 *
 * THE DEFECT: resolveCscsProvider() passed only the URL and key. The provider
 * looked for the username and password in env vars production does not set
 * (they are stored in CscsConfig), so every operative's check failed with
 * "not configured". The admin connection test and "Check this card now" build
 * the provider themselves with all four, so every test of THOSE paths passed.
 * This one drives the path operatives actually take.
 *
 * Run: npx tsx scripts/cscs_resolved_credentials_verify.ts
 */
import { createServer, type Server } from 'node:http';

// No credentials in the environment - exactly as in production.
for (const k of ['CSCS_SMARTCHECK_API_URL', 'CSCS_SMARTCHECK_API_KEY',
                 'CSCS_SMARTCHECK_USERNAME', 'CSCS_SMARTCHECK_PASSWORD', 'CSCS_PROVIDER']) delete process.env[k];

let stubUrl = '';
let mode: 'smartcheck' | 'mock' = 'smartcheck';
// The stored config, stubbed BEFORE the resolver is loaded.
require.cache[require.resolve('../services/cscs/cscsConfigService')] = {
  id: 'cscsConfigService', filename: 'cscsConfigService', loaded: true,
  exports: {
    getCscsRuntimeConfig: async () => ({
      providerId: mode, verificationEnabled: true, apiUrl: stubUrl,
      apiKey: 'STORED-KEY', username: 'STORED-USER', password: 'STORED-PASS', source: 'database',
    }),
  },
} as never;

const { resolveCscsProvider } = require('../services/cscs');
const { clearSmartCheckTokens } = require('../services/cscs/smartCheckAuth');

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const seen = { auth: null as any, authKey: '', card: null as any, cardAuth: '', cardCalls: 0 };
function stub(): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/authenticate') {
        seen.auth = body; seen.authKey = String(req.headers['x-api-key'] ?? '');
        res.end(JSON.stringify({ responseData: { userName: 'u', idToken: 'ID-TOKEN', accessToken: 'ACCESS' } }));
        return;
      }
      seen.cardCalls++; seen.card = body; seen.cardAuth = String(req.headers['authorization'] ?? '');
      res.end(JSON.stringify({ responseData: {
        cards: [{ cardSerial: 'x'.repeat(32), customerName: 'Wei Zhang', registrationNumber: '14660726',
                  expired: false, cancelled: false, cardColour: 'Blue' }],
        scheme: { schemeIdentifier: 'C4T', schemeName: 'Test Scheme' } } }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => {
    const a = server.address(); stubUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`; r(server);
  }));
}

async function main() {
  console.log('== THE OPERATIVE PATH CARRIES THE STORED CREDENTIALS ==\n');
  const server = await stub();
  try {
    clearSmartCheckTokens();
    const provider = await resolveCscsProvider('+447700900555');
    chk('the resolved provider is Smart Check', provider.name === 'smartcheck', provider.name);
    let result: any = null; let err = '';
    try {
      result = await provider.verifyCard({ cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' });
    } catch (e: any) { err = e?.message ?? String(e); }
    chk('it does NOT fail as "not configured"', !/not configured/i.test(err), err);
    chk('it signs in with the STORED username', seen.auth?.userName === 'STORED-USER', JSON.stringify(seen.auth?.userName));
    chk('...and the STORED password', seen.auth?.password === 'STORED-PASS');
    chk('...and the STORED key', seen.authKey === 'STORED-KEY', seen.authKey);
    chk('the card call is made', seen.cardCalls === 1);
    chk('...presenting the idToken', /ID-TOKEN/.test(seen.cardAuth) && !/ACCESS/.test(seen.cardAuth), seen.cardAuth);
    chk('...with scheme, surname and registration number',
        seen.card?.schemeIdentifier === 'C4T' && seen.card?.surname === 'Zhang' && seen.card?.cardSerialNumber === '14660726',
        JSON.stringify(seen.card));
    chk('a valid card comes back VALID', result?.status === 'VALID' && result?.verified === true, result?.status);

    // The exemption is untouched: it still resolves to the mock.
    process.env.CSCS_MOCK_MOBILES_ENABLED = '1'; process.env.CSCS_MOCK_MOBILES = '+447700900150';
    const exempt = await resolveCscsProvider('+447700900150');
    chk('the exempt test account still resolves to the mock', exempt.name === 'mock', exempt.name);
    mode = 'mock';
    chk('a stored Mock choice still resolves to the mock', (await resolveCscsProvider('+447700900555')).name === 'mock');

    const src = require('fs').readFileSync('services/cscs/index.ts', 'utf8');
    chk('buildCscsProvider passes the username and password through',
        /username: settings\.username,\s*password: settings\.password,/.test(src));
  } finally {
    (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.(); server.close();
  }
  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
