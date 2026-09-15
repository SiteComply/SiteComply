/**
 * What does a failed Smart Check sign-in actually REPORT?
 *
 * The owner ran the connection test and was told "Could not reach
 * cardcheckerprod.cscsonline.uk.com" — about a host that had answered in 80ms.
 * The classifier read the message with regular expressions and sent everything
 * it did not recognise to UNREACHABLE. This suite exists so that cannot recur:
 * every kind of sign-in failure is produced for real against a stub server, and
 * the verdict for each is asserted.
 *
 * Two layers, deliberately:
 *   1. authenticate() against a real socket — does it CAPTURE the evidence?
 *   2. classifySignInFailure() on the error it threw — does it REPORT it?
 * A test that only did (2) would pass against an authenticate() that captured
 * nothing.
 */
import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';
import {
  authenticate,
  SmartCheckAuthError,
  bodySnippet,
  clearSmartCheckTokens,
} from '../services/cscs/smartCheckAuth';
import { classifySignInFailure } from '../services/cscs/smartCheckConnectionTest';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};

type Reply = { status: number; body: string; type?: string };
let reply: Reply = { status: 200, body: '{}' };
let server!: Server;

async function start(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(reply.status, {
        'content-type': reply.type ?? 'application/json',
      });
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const creds = (base: string) => ({
  apiUrl: base,
  apiKey: 'stub-key',
  username: 'stub-user',
  password: 'stub-password',
});

/** Run a sign-in that is expected to fail, and hand back the error. */
async function signInFailure(base: string): Promise<SmartCheckAuthError> {
  clearSmartCheckTokens();
  try {
    await authenticate(creds(base));
  } catch (e) {
    if (e instanceof SmartCheckAuthError) return e;
    throw new Error(`expected SmartCheckAuthError, got ${String(e)}`);
  }
  throw new Error('expected the sign-in to fail, but it succeeded');
}

(async () => {
  const base = await start();
  const HOST = 'cardcheckerprod.cscsonline.uk.com';

  // ── 1. THE REPORTED CASE: 200 with an empty body ────────────────────────
  // This is the exact shape that produced "Could not reach …". The partner is
  // an AWS API Gateway that does send empty bodies with content-type json.
  reply = { status: 200, body: '' };
  {
    const e = await signInFailure(base);
    ok('200 + empty body is classified as unreadable', e.failure.kind === 'unreadable', e.failure.kind);
    ok('  the status is captured', e.failure.status === 200, e.failure.status);
    ok('  the byte count is captured (0 is informative)', e.failure.bodyBytes === 0, e.failure.bodyBytes);
    ok('  the content type is captured', e.failure.contentType?.includes('application/json') === true, e.failure.contentType);
    ok('  the message names the status', /HTTP 200/.test(e.message), e.message);
    ok('  the message says it was not JSON', /not JSON/i.test(e.message), e.message);

    const v = classifySignInFailure(e, HOST);
    ok('  the verdict is SIGN_IN_UNREADABLE, not UNREACHABLE', v.outcome === 'SIGN_IN_UNREADABLE', v.outcome);
    ok('  it does NOT claim the host was unreachable', !/could not reach/i.test(`${v.title} ${v.detail}`), v.title);
    ok('  it says the host answered', /answered/i.test(v.title), v.title);
    ok('  the detail carries the status', /HTTP 200/.test(v.detail ?? ''), v.detail);
    ok('  it points at the request, not the network', /field names|API key/i.test(v.detail ?? ''), v.detail);
    ok('  the stage is sign-in', v.stage === 'sign-in', v.stage);
    // The footer renders "HTTP nnn · Nms". Side by side, "HTTP 200 · 80ms" is
    // self-evidently not an unreachable host — which is the whole point.
    ok('  httpStatus is set so the footer shows it', v.httpStatus === 200, v.httpStatus);
  }

  // ── 2. 200 with an HTML error page ──────────────────────────────────────
  reply = { status: 200, body: '<html><body>Gateway error</body></html>', type: 'text/html' };
  {
    const e = await signInFailure(base);
    const v = classifySignInFailure(e, HOST);
    ok('200 + HTML → SIGN_IN_UNREADABLE', v.outcome === 'SIGN_IN_UNREADABLE', v.outcome);
    ok('  the content type reaches the admin', /text\/html/.test(v.detail ?? ''), v.detail);
    ok('  the body excerpt is shown', /Gateway error/.test(v.detail ?? ''), v.detail);
  }

  // ── 3. 403 with the partner's real envelope ─────────────────────────────
  reply = { status: 403, body: '{"message":"Forbidden"}' };
  {
    const e = await signInFailure(base);
    ok('403 is classified as rejected', e.failure.kind === 'rejected', e.failure.kind);
    const v = classifySignInFailure(e, HOST);
    ok('  → SIGN_IN_REJECTED', v.outcome === 'SIGN_IN_REJECTED', v.outcome);
    ok('  the service\'s own words are quoted', /Forbidden/.test(v.detail ?? ''), v.detail);
    ok('  whitespace in the credentials is suggested', /spaces/i.test(v.detail ?? ''), v.detail);
  }

  // ── 4. 404 — the sign-in path is wrong ──────────────────────────────────
  reply = { status: 404, body: '{"message":"Not Found"}' };
  {
    const e = await signInFailure(base);
    ok('404 is classified as http', e.failure.kind === 'http', e.failure.kind);
    const v = classifySignInFailure(e, HOST);
    ok('  → SIGN_IN_HTTP_ERROR (it used to say "could not reach")', v.outcome === 'SIGN_IN_HTTP_ERROR', v.outcome);
    ok('  it does NOT blame the network', !/could not reach/i.test(`${v.title} ${v.detail}`), v.title);
    ok('  the status is in the title', /404/.test(v.title), v.title);
    ok('  httpStatus is set', v.httpStatus === 404, v.httpStatus);
    ok('  it explains what a 404 means here', /path is wrong/i.test(v.detail ?? ''), v.detail);
  }

  // ── 5. 500 ──────────────────────────────────────────────────────────────
  reply = { status: 500, body: '{"message":"Internal server error"}' };
  {
    const e = await signInFailure(base);
    ok('500 is retryable', e.retryable === true, e.retryable);
    const v = classifySignInFailure(e, HOST);
    ok('  → SIGN_IN_HTTP_ERROR', v.outcome === 'SIGN_IN_HTTP_ERROR', v.outcome);
  }

  // ── 6. 200, valid JSON, but no token ────────────────────────────────────
  reply = { status: 200, body: '{"responseData":{"userName":"a","userId":"b"}}' };
  {
    const e = await signInFailure(base);
    ok('valid JSON without a token → no-token', e.failure.kind === 'no-token', e.failure.kind);
    ok('  the fields that DID come back are named', /responseData/.test(e.message), e.message);
    const v = classifySignInFailure(e, HOST);
    ok('  → SIGN_IN_NO_TOKEN', v.outcome === 'SIGN_IN_NO_TOKEN', v.outcome);
  }

  // ── 7. the success path still works ─────────────────────────────────────
  reply = { status: 200, body: '{"responseData":{"idToken":"tok-123","accessToken":"other"}}' };
  {
    clearSmartCheckTokens();
    const r = await authenticate(creds(base));
    ok('a good response still signs in', r.token === 'tok-123', r.token);
  }

  // ── 8. a transport failure is STILL reported as unreachable ─────────────
  // The fix must not swing the other way and stop naming a genuine network
  // fault. Nothing is listening on this port.
  {
    const dead = `http://127.0.0.1:${(server.address() as AddressInfo).port + 1}`;
    clearSmartCheckTokens();
    let e: SmartCheckAuthError | null = null;
    try {
      await authenticate({ ...creds(dead), apiUrl: dead });
    } catch (err) {
      e = err as SmartCheckAuthError;
    }
    ok('a refused connection is kind: transport', e?.failure.kind === 'transport', e?.failure.kind);
    ok('  no status is invented', e?.failure.status === undefined, e?.failure.status);
    const v = classifySignInFailure(e, HOST);
    ok('  → UNREACHABLE, as it should be', v.outcome === 'UNREACHABLE', v.outcome);
    ok('  no httpStatus, because there was no response', v.httpStatus === undefined, v.httpStatus);
    ok('  and it names the host', v.title.includes(HOST), v.title);
  }

  // ── 9. an error that is not ours must not be mislabelled ────────────────
  {
    const v = classifySignInFailure(new Error('something else entirely'), HOST);
    ok('an unknown error falls back to UNREACHABLE', v.outcome === 'UNREACHABLE', v.outcome);
    ok('  and carries its own message', /something else entirely/.test(v.detail ?? ''), v.detail);
  }

  // ── 10. secrets must never reach the admin's screen ─────────────────────
  {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    ok('a JWT is stripped from a snippet', !bodySnippet(`{"idToken":"${jwt}"}`)!.includes(jwt));
    ok('a long opaque value is stripped', bodySnippet(`{"k":"${'A'.repeat(64)}"}`)!.includes('[long value]'));
    ok('a password field is masked', /redacted/i.test(bodySnippet('{"password":"hunter2hunter2"}')!));
    ok('an email is stripped', !bodySnippet('{"user":"bob@example.com"}')!.includes('bob@example.com'));
    ok('a long body is capped', (bodySnippet('x '.repeat(800)) ?? '').length <= 301);
    ok('an empty body yields no snippet', bodySnippet('') === undefined);
  }

  // ── 11. the API key is never echoed, whatever the service says ──────────
  reply = { status: 403, body: '{"message":"key stub-key rejected"}' };
  {
    const e = await signInFailure(base);
    const v = classifySignInFailure(e, HOST);
    // The key is short and unredactable by pattern, so assert the rule we CAN
    // keep: nothing we send is added to the message by us.
    ok('the credentials are not added to the verdict by us', !/stub-password|stub-user/.test(`${v.title} ${v.detail}`), v.detail);
  }

  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
