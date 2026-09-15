/**
 * Smart Check V2.6 authentication (SC-001 Phase 2).
 *
 * Runs against a LOCAL stub that speaks the V2.6 shape, so the protocol
 * mechanics — token caching, single-flight, expiry, re-authenticate-once,
 * credential isolation — are proven without touching the partner API or holding
 * any real credential.
 *
 * What this CANNOT prove is the partner's exact field names; those are isolated
 * in AUTH_SHAPE and REQUEST_SHAPE and still need confirming against V2.6.
 *
 * Run: npx tsx scripts/smartcheck_auth_verify.ts
 */
import { createServer, type Server } from 'node:http';
import {
  getSmartCheckToken,
  authenticate,
  clearSmartCheckTokens,
  authHeaders,
  AUTH_SHAPE,
} from '../services/cscs/smartCheckAuth';
import { SmartCheckCscsProvider } from '../services/cscs/smartCheckProvider';

let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

interface StubState {
  authCalls: number;
  cardCalls: number;
  lastAuthBody: Record<string, unknown> | null;
  lastAuthHeaders: Record<string, string>;
  lastCardHeaders: Record<string, string>;
  authStatus: number;
  authBody: unknown;
  cardStatus: number;
  cardBody: unknown;
  /** Reject the first card call with 401, to exercise the retry. */
  expireFirstCard: boolean;
}

/**
 * Close a stub and drop its sockets.
 *
 * `server.close()` alone waits for keep-alive connections, and undici holds them
 * open — so the script ran to completion and then hung forever with its output
 * still buffered, which looked like a hang at the very first assertion.
 */
function shut(server: Server): void {
  (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  server.close();
}

function stub(state: StubState): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString() || '{}';
      const headers = req.headers as unknown as Record<string, string>;
      if (req.url === AUTH_SHAPE.path) {
        state.authCalls++;
        state.lastAuthBody = JSON.parse(body);
        state.lastAuthHeaders = headers;
        res.writeHead(state.authStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(state.authBody));
        return;
      }
      state.cardCalls++;
      state.lastCardHeaders = headers;
      if (state.expireFirstCard && state.cardCalls === 1) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(state.cardStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.cardBody));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const fresh = (over: Partial<StubState> = {}): StubState => ({
  authCalls: 0,
  cardCalls: 0,
  lastAuthBody: null,
  lastAuthHeaders: {},
  lastCardHeaders: {},
  authStatus: 200,
  // The CONFIRMED V2.6 /authenticate success body. Both tokens present, wrapped
  // in responseData, and no expiry field of any kind.
  authBody: {
    responseData: {
      userName: 'partner',
      userId: 'u-1',
      idToken: 'ID-TOKEN',
      accessToken: 'ACCESS-TOKEN',
      itPartner: 'sitecomply',
    },
  },
  cardStatus: 200,
  cardBody: { status: 'VALID', expiry: '2030-01-01' },
  expireFirstCard: false,
  ...over,
});

async function main() {
  console.log('== SMART CHECK V2.6 AUTHENTICATION ==\n');

  console.log('[1] Sign-in sends what V2.6 asks for');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const creds = { apiUrl: url, apiKey: 'KEY', username: 'USER', password: 'PASS' };
    const { token } = await authenticate(creds);
    chk('it calls /authenticate', state.authCalls === 1);
    chk('the API key goes in x-api-key, not Authorization',
        state.lastAuthHeaders[AUTH_SHAPE.apiKeyHeader] === 'KEY' &&
        !state.lastAuthHeaders['authorization'],
        `x-api-key=${state.lastAuthHeaders[AUTH_SHAPE.apiKeyHeader]}`);
    chk('username and password go in the body',
        state.lastAuthBody?.username === 'USER' && state.lastAuthBody?.password === 'PASS');
    chk('the token comes back', token === 'ID-TOKEN', token);
    shut(server);
  }

  console.log('\n[2] The token is reused, and ten callers cause ONE sign-in');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const creds = { apiUrl: url, apiKey: 'KEY', username: 'USER', password: 'PASS' };
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => getSmartCheckToken(creds)),
    );
    chk('ten concurrent callers, one sign-in', state.authCalls === 1, `${state.authCalls} calls`);
    chk('they all get the same token', new Set(tokens).size === 1);
    await getSmartCheckToken(creds);
    chk('a later call reuses the cache', state.authCalls === 1, `${state.authCalls} calls`);
    shut(server);
  }

  console.log('\n[3] An expired token is not reused');
  {
    // V2.6 documents no expiry field, but the code still honours one if it ever
    // appears — so this is a hypothetical response, in the confirmed wrapper.
    const state = fresh({
      authBody: { responseData: { idToken: 'short', expiresIn: 1 } },
    });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const creds = { apiUrl: url, apiKey: 'K', username: 'U', password: 'P' };
    await getSmartCheckToken(creds);
    // expiresIn 1s minus the 60s safety margin is already in the past.
    await getSmartCheckToken(creds);
    chk('a token expiring within the safety margin is refreshed',
        state.authCalls === 2, `${state.authCalls} sign-ins`);
    shut(server);
  }

  console.log('\n[4] Different credentials never share a token');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    await getSmartCheckToken({ apiUrl: url, apiKey: 'K', username: 'A', password: 'P' });
    await getSmartCheckToken({ apiUrl: url, apiKey: 'K', username: 'B', password: 'P' });
    chk('a second username signs in separately', state.authCalls === 2,
        'a shared slot would let a connection test poison the live path');
    shut(server);
  }

  console.log('\n[5] A stale token earns exactly one retry');
  {
    const state = fresh({ expireFirstCard: true });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const provider = new SmartCheckCscsProvider({
      apiUrl: url, apiKey: 'K', username: 'U', password: 'P',
    });
    const result = await provider.verifyCard({
      cardNumber: '12345678', holderName: null, scheme: null,
      cardTypeHint: null, expiryHint: null,
    } as never);
    chk('the card call is retried after a 401', state.cardCalls === 2, `${state.cardCalls} card calls`);
    chk('it re-authenticated before retrying', state.authCalls === 2, `${state.authCalls} sign-ins`);
    chk('and the result comes back', result.status === 'VALID', result.status);
    shut(server);
  }

  console.log('\n[6] A persistent 401 does NOT loop');
  {
    const state = fresh({ cardStatus: 401, cardBody: {} });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const provider = new SmartCheckCscsProvider({
      apiUrl: url, apiKey: 'K', username: 'U', password: 'P',
    });
    let message = '';
    try {
      await provider.verifyCard({
        cardNumber: '12345678', holderName: null, scheme: null,
        cardTypeHint: null, expiryHint: null,
      } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    chk('exactly two card attempts, then it stops', state.cardCalls === 2, `${state.cardCalls}`);
    chk('it says the credentials were rejected', /rejected our credentials/i.test(message), message);
    shut(server);
  }

  console.log('\n[7] Rejected credentials are named as such, and never echoed');
  {
    const state = fresh({ authStatus: 401, authBody: { error: 'nope' } });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    let message = '';
    try {
      await authenticate({ apiUrl: url, apiKey: 'SECRET-KEY', username: 'U', password: 'SECRET-PASS' });
    } catch (e) { message = (e as Error).message; }
    chk('the message names the credentials as the problem',
        /rejected the username, password or API key/i.test(message), message);
    chk('it does not echo the API key', !message.includes('SECRET-KEY'));
    chk('it does not echo the password', !message.includes('SECRET-PASS'));
    shut(server);
  }

  console.log('\n[8] A missing token fails loudly, not silently');
  {
    const state = fresh({ authBody: { somethingElse: 'x' } });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    let message = '';
    try {
      await authenticate({ apiUrl: url, apiKey: 'K', username: 'U', password: 'P' });
    } catch (e) { message = (e as Error).message; }
    chk('it refuses rather than proceeding with undefined',
        /no token was found/i.test(message), message);
    chk('and it lists the names it looked for',
        AUTH_SHAPE.tokenFields.every((f) => message.includes(f)),
        'so the fix is obvious from the message alone');
    shut(server);
  }

  console.log('\n[9] The card call carries the token');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const creds = { apiUrl: url, apiKey: 'K', username: 'U', password: 'P' };
    const provider = new SmartCheckCscsProvider(creds);
    await provider.verifyCard({
      cardNumber: '12345678', holderName: null, scheme: null,
      cardTypeHint: null, expiryHint: null,
    } as never);
    const sent = state.lastCardHeaders['authorization'] ?? '';
    chk('Authorization carries the bearer token', sent === 'Bearer ID-TOKEN', sent);
    chk('the API key is sent alongside it',
        state.lastCardHeaders[AUTH_SHAPE.apiKeyHeader] === 'K',
        'AUTH_SHAPE.sendApiKeyWithToken — confirm against the documentation');
    const h = authHeaders(creds, 'T');
    chk('authHeaders is what the card call uses', h[AUTH_SHAPE.tokenHeader] === 'Bearer T');
    shut(server);
  }

  console.log('\n[10] The CONFIRMED V2.6 response shape');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const { token } = await authenticate({
      apiUrl: url, apiKey: 'K', username: 'U', password: 'P',
    });
    chk('the token is read from inside responseData', token === 'ID-TOKEN', token);
    chk('it picks idToken, NOT accessToken', token !== 'ACCESS-TOKEN',
        'the card endpoint names idToken; an earlier ordering picked accessToken');
    chk('accessToken is never used as a fallback',
        !AUTH_SHAPE.tokenFields.includes('accessToken'),
        AUTH_SHAPE.tokenFields.join(', '));
    shut(server);
  }

  console.log('\n[11] No expiry field is documented, so a short life is assumed');
  {
    const state = fresh();
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    const creds = { apiUrl: url, apiKey: 'K', username: 'U', password: 'P' };
    const { expiresAt } = await authenticate(creds);
    const minutes = (expiresAt - Date.now()) / 60000;
    chk('a token with no stated expiry is cached briefly, not forever',
        minutes > 0 && minutes <= 10, `${minutes.toFixed(1)} minutes`);
    chk('and it is still cached within that window',
        (await getSmartCheckToken(creds)) === 'ID-TOKEN' && state.authCalls === 2,
        `${state.authCalls} sign-ins`);
    shut(server);
  }

  console.log('\n[12] If idToken disappears it fails loudly, not quietly');
  {
    const state = fresh({
      authBody: { responseData: { accessToken: 'ONLY-ACCESS', userId: 'u' } },
    });
    const { server, url } = await stub(state);
    clearSmartCheckTokens();
    let message = '';
    try {
      await authenticate({ apiUrl: url, apiKey: 'K', username: 'U', password: 'P' });
    } catch (e) { message = (e as Error).message; }
    chk('a response with only accessToken is refused',
        /no token was found/i.test(message), message);
    chk('it does not silently send accessToken instead',
        !message.includes('ONLY-ACCESS'),
        'a contract change should fail, not be papered over');
    shut(server);
  }

  console.log('\n[13] A timeout is reported as a timeout, not as unreachable');
  {
    // A server that accepts the connection and never answers. Before this, the
    // 15s abort surfaced as "could not reach", indistinguishable from the host
    // being down — which is exactly what happened on the first live attempt.
    const slow = createServer(() => { /* never responds */ });
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', () => r()));
    const a = slow.address();
    const port = typeof a === 'object' && a ? a.port : 0;
    clearSmartCheckTokens();
    let message = '';
    const started = Date.now();
    try {
      await authenticate({
        apiUrl: `http://127.0.0.1:${port}`, apiKey: 'K', username: 'U', password: 'P',
      });
    } catch (e) { message = (e as Error).message; }
    const waited = (Date.now() - started) / 1000;
    chk('it says the service did not answer in time',
        /did not answer within/i.test(message), message);
    chk('it does NOT claim the host was unreachable',
        !/could not reach/i.test(message));
    chk('and it waited the full timeout first', waited >= 29, `${waited.toFixed(0)}s`);
    shut(slow);
  }

  console.log('\n[14] Without all four credentials it refuses to run');
  {
    let message = '';
    try {
      await new SmartCheckCscsProvider({ apiUrl: 'https://x', apiKey: 'K' }).verifyCard({
        cardNumber: '1', holderName: null, scheme: null,
        cardTypeHint: null, expiryHint: null,
      } as never);
    } catch (e) { message = (e as Error).message; }
    chk('three of four is refused', /not configured/i.test(message), message);
    chk('and it names all four', /username and password/i.test(message));
  }

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  // Explicit: a lingering socket must not turn a finished run into a hang.
  .finally(() => process.exit(failures.length ? 1 : 0));
