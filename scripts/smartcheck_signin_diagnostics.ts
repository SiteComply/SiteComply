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
import { readFileSync } from 'fs';
import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';
import {
  authenticate,
  SmartCheckAuthError,
  bodySnippet,
  clearSmartCheckTokens,
} from '../services/cscs/smartCheckAuth';
import {
  classifySignInFailure,
  signInWithCandidateShapes,
  classifySmartCheckResponse,
  ALTERNATE_REG_COUNT,
} from '../services/cscs/smartCheckConnectionTest';
import { CANDIDATE_AUTH_PRESENTATIONS, authHeaders } from '../services/cscs/smartCheckAuth';
import {
  REQUEST_SHAPE,
  cardRequestBody,
  CANDIDATE_SCAN_TYPES,
  SCAN_TYPE_SENTINEL,
  CANDIDATE_FIELD_NAMINGS,
} from '../services/cscs/smartCheckProvider';
import {
  CANDIDATE_FIELD_SHAPES,
  AUTH_SHAPE,
  keptHeaders,
  envelopeMessage,
  describeShape,
  shapeSummary,
  tokenLikePaths,
} from '../services/cscs/smartCheckAuth';

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
    // Derive the allowance from the marker rather than hardcoding it: the
    // ellipsis went from one character to three when the output was made
    // ASCII-only, and a literal 301 failed a cap that was working fine.
    const MARKER = '...';
    ok('a long body is capped',
      (bodySnippet('x '.repeat(800)) ?? '').length <= 300 + MARKER.length,
      (bodySnippet('x '.repeat(800)) ?? '').length);
    ok('  and says it was truncated', (bodySnippet('x '.repeat(800)) ?? '').endsWith(MARKER));
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

  // ── 12. the request we put on the wire ──────────────────────────────────
  // Captured from the stub, not read off AUTH_SHAPE: undici adds headers of its
  // own, and reading the constants would miss them.
  {
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const rec = createServer((req, res) => {
      const cs: Buffer[] = [];
      req.on('data', (c) => cs.push(c));
      req.on('end', () => {
        sent.push({
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(cs).toString(),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"responseData":{"idToken":"t"}}');
      });
    });
    await new Promise<void>((r) => rec.listen(0, '127.0.0.1', r));
    const p = (rec.address() as AddressInfo).port;
    clearSmartCheckTokens();
    await authenticate(creds(`http://127.0.0.1:${p}`));
    const req = sent[0]!;

    ok('we identify ourselves, not as "node"', req.headers['user-agent'] === AUTH_SHAPE.userAgent, req.headers['user-agent']);
    ok('the api key rides on x-api-key', req.headers['x-api-key'] === 'stub-key', Object.keys(req.headers));
    ok('content-type is application/json', req.headers['content-type'] === 'application/json');
    // Asserted against AUTH_SHAPE, not against a literal: the casing is the thing
    // that was wrong, so hard-coding it here would just re-freeze the old bug.
    ok('the body is exactly the two fields AUTH_SHAPE names',
      JSON.stringify(Object.keys(JSON.parse(req.body)).sort()) ===
        JSON.stringify([AUTH_SHAPE.fields.password, AUTH_SHAPE.fields.username].sort()), req.body);
    ok('  and the live shape is the capital-N one the service accepted',
      AUTH_SHAPE.fields.username === 'userName', AUTH_SHAPE.fields.username);

    // The live path must ALWAYS send AUTH_SHAPE.fields — the probe is the
    // connection test's business and must never leak into verification.
    ok('authenticate() with no override uses AUTH_SHAPE.fields',
      JSON.parse(req.body)[AUTH_SHAPE.fields.username] === 'stub-user', req.body);

    // …and an override really does change them.
    sent.length = 0;
    clearSmartCheckTokens();
    await authenticate(creds(`http://127.0.0.1:${p}`), { username: 'userName', password: 'password' });
    ok('an override changes the field name', 'userName' in JSON.parse(sent[0]!.body), sent[0]!.body);

    rec.closeAllConnections();
    await new Promise<void>((r) => rec.close(() => r()));
  }

  // ── 13. the candidate-shape probe: when it retries, and when it must not ─
  {
    const empty200 = new SmartCheckAuthError('empty', { kind: 'unreadable', status: 200, bodyBytes: 0 });
    const refused = new SmartCheckAuthError('no', { kind: 'rejected', status: 403 });
    const gone = new SmartCheckAuthError('nope', { kind: 'transport' });

    let calls: string[] = [];
    const fake = (results: (unknown | { token: string })[]) => {
      let i = 0;
      return async (_c: unknown, f: { username: string; password: string }) => {
        calls.push(f.username);
        const r = results[i++];
        if (r instanceof Error) throw r;
        return r as { token: string };
      };
    };
    const C = creds('http://x');

    calls = [];
    let r = await signInWithCandidateShapes(C, fake([empty200, { token: 'tok' }]) as never);
    ok('an empty 2xx makes it try the next shape', calls.length === 2, calls);
    ok('  and it reports which shape was accepted', r.acceptedShape === CANDIDATE_FIELD_SHAPES[1]!.label, r.acceptedShape);
    ok('  returning the token', r.token === 'tok', r.token);

    calls = [];
    r = await signInWithCandidateShapes(C, fake([refused]) as never);
    ok('rejected credentials do NOT trigger a second submission', calls.length === 1, calls);
    ok('  and the error is carried out', r.error === refused);

    calls = [];
    r = await signInWithCandidateShapes(C, fake([gone]) as never);
    ok('a transport failure does NOT trigger a second submission', calls.length === 1, calls);

    calls = [];
    r = await signInWithCandidateShapes(C, fake([{ token: 'first' }]) as never);
    ok('a first-shape success sends exactly one request', calls.length === 1, calls);
    ok('  and names the current shape', r.acceptedShape === CANDIDATE_FIELD_SHAPES[0]!.label, r.acceptedShape);

    calls = [];
    r = await signInWithCandidateShapes(C, fake([empty200, empty200]) as never);
    ok('every shape failing stops at the list length', calls.length === CANDIDATE_FIELD_SHAPES.length, calls);
    ok('  the probe is capped at two — a partner lockout is a real risk', CANDIDATE_FIELD_SHAPES.length === 2, CANDIDATE_FIELD_SHAPES.length);
    const v = classifySignInFailure(r.error, HOST, r.tried);
    ok('  the verdict lists what was tried', /Body field names tried, in order/.test(v.detail ?? ''), v.detail);
  }

  // ── 14. response headers: allow-list, and they reach the admin ──────────
  {
    const h = new Headers({
      'x-amzn-requestid': 'abc-123',
      'x-amzn-errortype': 'ForbiddenException',
      'content-length': '0',
      'set-cookie': 'session=secret',
      'x-secret-thing': 'nope',
    });
    const kept = keptHeaders(h)!;
    ok('the AWS request id is kept (CSCS can trace it)', kept['x-amzn-requestid'] === 'abc-123', kept);
    ok('the AWS error type is kept', kept['x-amzn-errortype'] === 'ForbiddenException', kept);
    ok('an unlisted header is dropped', !('x-secret-thing' in kept), kept);
    ok('set-cookie is dropped', !('set-cookie' in kept), kept);
    ok('no headers at all yields undefined', keptHeaders(new Headers()) === undefined);

    const e = new SmartCheckAuthError('x', {
      kind: 'unreadable', status: 200, bodyBytes: 0,
      contentType: 'application/json', responseHeaders: kept,
      fieldShape: 'username / password',
    });
    const v = classifySignInFailure(e, HOST);
    ok('the request id reaches the admin', /abc-123/.test(v.detail ?? ''), v.detail);
    ok('the request we sent is echoed back', /POST \/authenticate/.test(v.detail ?? ''), v.detail);
    ok('  including the body field names', /username, password/.test(v.detail ?? ''), v.detail);
    ok('  and the headers we set', /x-api-key/.test(v.detail ?? ''), v.detail);
  }

  // ── 15. the response SHAPE: structure shown, values masked ─────────────
  // The envelope the owner reported: responseMethod, responseMessage,
  // responseData, responseCode, errorCode — an application-level outcome
  // wrapped inside an HTTP 200.
  {
    const JWT = 'eyJ' + 'a'.repeat(800);
    const envelope = {
      responseMethod: 'authenticate',
      responseMessage: 'Invalid credentials for bob@example.com',
      responseCode: '401',
      errorCode: 'AUTH_001',
      responseData: { security: { idToken: JWT, accessToken: 'b'.repeat(700) }, userName: 'jsmith' },
    };
    const shape = shapeSummary(envelope);

    ok('the token value is never printed', !shape.includes(JWT.slice(0, 40)), shape.slice(0, 120));
    ok('  it is described by type and length instead', /idToken: <string, 803 chars>/.test(shape), shape);
    ok('the envelope message IS shown — it is the diagnosis', /Invalid credentials/.test(shape), shape);
    ok('  but a person in it is still redacted', !shape.includes('bob@example.com'), shape);
    ok('the response code is shown', /responseCode: "401"/.test(shape), shape);
    ok('the error code is shown', /errorCode: "AUTH_001"/.test(shape), shape);
    ok('a non-envelope string is masked, not shown', !/jsmith/.test(shape), shape);
    ok('nesting is preserved', /responseData: \{security: \{/.test(shape), shape);

    const paths = tokenLikePaths(envelope);
    ok('a renamed/renested token is located', paths.some((p) => p.startsWith('responseData.security.idToken')), paths);
    ok('  with its length, not its value', /803 chars/.test(paths.join('|')), paths);
    ok('  and the second one too', paths.some((p) => p.includes('accessToken')), paths);
    ok('an empty responseData reports as null', /responseData: null/.test(shapeSummary({ responseData: null })));
    ok('no token-like field yields no paths', tokenLikePaths({ responseData: { a: 1 } }).length === 0);
    ok('depth is bounded', describeShape({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }).includes('<object>'));
    const big = shapeSummary({ big: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, 'x'])) });
    ok('the summary is capped', big.length <= 900 + '...'.length, big.length);
    ok('  and says it was truncated', big.endsWith('...'));
  }

  // ── 16. that shape reaches the admin, end to end ───────────────────────
  {
    reply = {
      status: 200,
      body: JSON.stringify({
        responseMethod: 'authenticate',
        responseMessage: 'Success',
        responseCode: '200',
        errorCode: null,
        responseData: { security: { idToken: 'x'.repeat(500) } },
      }),
    };
    const e = await signInFailure(base);
    ok('a token nested elsewhere still fails loudly', e.failure.kind === 'no-token', e.failure.kind);
    ok('  the message locates it', /responseData\.security\.idToken/.test(e.message), e.message);
    ok('  and prints the masked shape', /responseMethod: "authenticate"/.test(e.message), e.message);
    ok('  the failure carries the shape as data too', /responseData/.test(e.failure.responseShape ?? ''), e.failure.responseShape);

    const v = classifySignInFailure(e, HOST);
    ok('  the verdict no longer claims we signed in', !/^Signed in/.test(v.title), v.title);
    ok('  the shape reaches the admin', /security/.test(v.detail ?? ''), v.detail);
  }

  // ── 17. a payload nested as a STRING ───────────────────────────────────
  // Masked flat this reads <string, N chars> — indistinguishable from a token,
  // and the fields inside would never be seen.
  {
    const inner = JSON.stringify({ idToken: 'z'.repeat(600), userName: 'jsmith' });
    const env = { responseCode: '200', responseData: inner };
    const shape = shapeSummary(env);
    ok('a stringified payload is recognised as JSON', /<json string, \d+ chars>/.test(shape), shape);
    ok('  and its fields are described', /idToken: <string, 600 chars>/.test(shape), shape);
    ok('  while its values stay masked', !shape.includes('z'.repeat(40)), shape.slice(0, 100));
    ok('  and a non-envelope value inside is masked too', !/jsmith/.test(shape), shape);
    ok('a token inside a stringified payload is located',
      tokenLikePaths(env).some((p2) => p2.startsWith('responseData.idToken')), tokenLikePaths(env));
    ok('a string that only looks like JSON falls back to the mask',
      /<string, 9 chars>/.test(shapeSummary({ a: '{not json' })), shapeSummary({ a: '{not json' }));
    ok('a plain string is untouched by the JSON path',
      /<string, 5 chars>/.test(shapeSummary({ a: 'hello' })), shapeSummary({ a: 'hello' }));
  }

  // ── 18. the no-token verdict says WHICH body shape produced it ─────────
  {
    const e = new SmartCheckAuthError('no token here', {
      kind: 'no-token', status: 200, fieldShape: 'userName / password',
    });
    const v = classifySignInFailure(e, HOST);
    ok('the verdict names the body shape that got through', /\{userName, password\}/.test(v.detail ?? ''), v.detail);

    const e2 = new SmartCheckAuthError('no token here', {
      kind: 'no-token', status: 200, fieldShape: 'username / password',
    });
    ok('  and distinguishes the lowercase one',
      /\{username, password\}/.test(classifySignInFailure(e2, HOST).detail ?? ''),
      classifySignInFailure(e2, HOST).detail);
  }

  // ── 19. the card-stage 403 must not assert a cause it cannot tell apart ─
  // Measured against the live gateway: a nonsense path under the same base
  // returns 403 with an empty body — identical to a refused token.
  {
    const tried = CANDIDATE_AUTH_PRESENTATIONS.map((p) => `${p.label} → 403`);
    const v = classifySmartCheckResponse(403, '', HOST, {
      tried,
      headers: { 'x-amzn-requestid': 'req-9' },
    });
    ok('a card 403 still reports sign-in as successful', /Authentication passed/.test(v.detail), v.detail);
    ok('  it does NOT name the header format as the blocker',
      !/whether the Authorization header wants a bare token/.test(v.detail), v.detail);
    // These two asserted the pre-/card state, when the path was a guess and the
    // 403 was most likely an unmatched route. The path is documented now, so the
    // verdict must name what is ACTUALLY left rather than repeat a solved doubt.
    ok('  it states the path is the documented one', /is the documented one/.test(v.detail), v.detail);
    ok('  it no longer calls the path unconfirmed', !/card path is NOT confirmed/.test(v.detail), v.detail);
    ok('  it names the key\'s authorisation as the remaining cause',
      /authorised for this endpoint/.test(v.detail), v.detail);
    ok('  and still does not blame the credentials', /Authentication passed/.test(v.detail), v.detail);
    ok('  it reports every presentation tried', tried.every((t) => v.detail.includes(t)), v.detail);
    ok('  and draws the conclusion from all four failing', /is not what a single wrong header format looks like/.test(v.detail), v.detail);
    ok('  the AWS request id is carried', /req-9/.test(v.detail), v.detail);
    ok('  the stage is card-check', v.stage === 'card-check', v.stage);
  }

  // ── 20. the four token presentations ───────────────────────────────────
  {
    ok('all four combinations are covered', CANDIDATE_AUTH_PRESENTATIONS.length === 4, CANDIDATE_AUTH_PRESENTATIONS.length);
    const labels = CANDIDATE_AUTH_PRESENTATIONS.map((p) => `${p.prefix}|${p.sendApiKey}`);
    ok('  they are distinct', new Set(labels).size === 4, labels);
    ok('  the first is what AUTH_SHAPE sends today',
      CANDIDATE_AUTH_PRESENTATIONS[0]!.prefix === AUTH_SHAPE.tokenPrefix &&
        CANDIDATE_AUTH_PRESENTATIONS[0]!.sendApiKey === AUTH_SHAPE.sendApiKeyWithToken,
      CANDIDATE_AUTH_PRESENTATIONS[0]);

    const C = creds('https://x');
    const bearer = authHeaders(C, 'TOK', CANDIDATE_AUTH_PRESENTATIONS[0]!);
    ok('Bearer form sets the scheme', bearer[AUTH_SHAPE.tokenHeader] === 'Bearer TOK', bearer);
    ok('  and includes the key', bearer[AUTH_SHAPE.apiKeyHeader] === 'stub-key', bearer);

    const bare = authHeaders(C, 'TOK', { prefix: '', sendApiKey: false });
    ok('bare form sends the token alone', bare[AUTH_SHAPE.tokenHeader] === 'TOK', bare);
    ok('  and omits the key entirely', !(AUTH_SHAPE.apiKeyHeader in bare), bare);

    const live = authHeaders(C, 'TOK');
    ok('with no override it uses AUTH_SHAPE', live[AUTH_SHAPE.tokenHeader] === `${AUTH_SHAPE.tokenPrefix}TOK`, live);
    ok('the card call identifies itself too', live['user-agent'] === AUTH_SHAPE.userAgent, live['user-agent']);
  }

  // ── 21. the documented card endpoint ───────────────────────────────────
  {
    ok('the card path is the documented /card', REQUEST_SHAPE.path === '/card', REQUEST_SHAPE.path);
    ok('  the legacy guess is gone', !/v1\/card\/verify/.test(REQUEST_SHAPE.path), REQUEST_SHAPE.path);
    ok('  and it is marked confirmed', REQUEST_SHAPE.pathConfirmed === true);
    ok('  appended to the /v2 base it gives one version segment',
      (('https://h/smarttech/v2' + REQUEST_SHAPE.path).match(/\/v\d+/g) ?? []).length === 1,
      'https://h/smarttech/v2' + REQUEST_SHAPE.path);

    // The three parts are confirmed; their casing is not, and the code must
    // still say so or a wrong mapping would wear a confirmed badge.
    // The three parts that identify a CARD, plus scanType — which describes how
    // WE captured it, not who the card belongs to. Asserted as an exact set so a
    // field cannot be added without a decision.
    ok('the request is built from the three documented parts, plus scanType',
      JSON.stringify(Object.keys(REQUEST_SHAPE.fields).sort()) ===
        '["registrationNumber","scanType","schemeId","surname"]', REQUEST_SHAPE.fields);
    ok('  cardNumber is no longer a request field',
      !Object.keys(REQUEST_SHAPE.fields).includes('cardNumber'), REQUEST_SHAPE.fields);
    ok('  the casing is still flagged unconfirmed', REQUEST_SHAPE.fieldsConfirmed === false);
  }

  // ── 22. an incomplete lookup is REFUSED, never improvised ──────────────
  // A lookup missing a surname comes back "not found", and "not found" at a site
  // gate reads as a rejected card. Refusing names the real problem.
  {
    const full = { cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' };
    const body = cardRequestBody(full);
    ok('a complete input builds the documented three fields',
      body[REQUEST_SHAPE.fields.registrationNumber] === '14660726' &&
      body[REQUEST_SHAPE.fields.surname] === 'Zhang' &&
      body[REQUEST_SHAPE.fields.schemeId] === 'C4T', body);
    ok('  and nothing else', Object.keys(body).length === 4, body);
    ok('  scanType among them', REQUEST_SHAPE.fields.scanType in body, body);

    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['no surname', { cardNumber: '1', schemeId: 'C4T' }, /surname/],
      ['no scheme id', { cardNumber: '1', surname: 'Z' }, /scheme ID/],
      ['no card number', { cardNumber: '', surname: 'Z', schemeId: 'C4T' }, /registration number/],
      ['none of them', { cardNumber: '' }, /registration number, surname, scheme ID/],
    ];
    for (const [label, input, expect] of cases) {
      let msg = '';
      try { cardRequestBody(input as never); } catch (e) { msg = (e as Error).message; }
      ok(`${label} → refused, naming what is missing`, expect.test(msg), msg || '(did not throw)');
    }
    // Whitespace must not pass for a value.
    let blank = '';
    try { cardRequestBody({ cardNumber: '1', surname: '   ', schemeId: 'C4T' } as never); }
    catch (e) { blank = (e as Error).message; }
    ok('a whitespace-only surname does not count as present', /surname/.test(blank), blank || '(did not throw)');
  }

  // ── 23. an incomplete lookup must not be reported as an outage ─────────
  // The refusal is built before the fetch's try block; inside it, the network
  // handler caught it and rewrapped a missing surname as "could not reach".
  {
    const src = readFileSync('services/cscs/smartCheckProvider.ts', 'utf8');
    const fn = src.slice(src.indexOf('private async callValidate('));
    const bodyBuilt = fn.indexOf('cardRequestBody(input)');
    const tryAt = fn.indexOf('try {');
    ok('the card body is built BEFORE the try block', bodyBuilt < tryAt && bodyBuilt !== -1,
      `body@${bodyBuilt} try@${tryAt}`);
    ok('and a considered verdict is not rewrapped as a network error',
      /if \(e instanceof CscsVerifyError\) throw e;/.test(fn), 'guard missing');
  }

  // ── 24. scanType: a NUMBER, as V2.6 documents it ───────────────────────
  // This block previously asserted that every candidate "means entered by
  // hand" - which was true of six strings that could never work, because the
  // documented type is Number. An assertion can be perfectly satisfied and
  // still be guarding the wrong property.
  {
    ok('scanType is a card request field',
      REQUEST_SHAPE.fields.scanType === 'scanType', REQUEST_SHAPE.fields);
    ok('  and the value is a NUMBER, not a string',
      typeof REQUEST_SHAPE.scanType === 'number', typeof REQUEST_SHAPE.scanType);
    ok('  specifically 3, which V2.6 documents as Manual entry',
      REQUEST_SHAPE.scanType === 3, REQUEST_SHAPE.scanType);
    ok('  and it is now marked confirmed against the documentation',
      REQUEST_SHAPE.scanTypeConfirmed === true);
    ok('every candidate is a number', CANDIDATE_SCAN_TYPES.every((c) => typeof c === 'number'), CANDIDATE_SCAN_TYPES);
    ok('  the live value is tried first', CANDIDATE_SCAN_TYPES[0] === REQUEST_SHAPE.scanType, CANDIDATE_SCAN_TYPES);
    ok('the sentinel is an out-of-range NUMBER',
      typeof SCAN_TYPE_SENTINEL === 'number' && !CANDIDATE_SCAN_TYPES.includes(SCAN_TYPE_SENTINEL),
      SCAN_TYPE_SENTINEL);

    const body = cardRequestBody({ cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' });
    ok('the live body carries scanType', body[REQUEST_SHAPE.fields.scanType] === REQUEST_SHAPE.scanType, body);
    ok('  four fields, no more', Object.keys(body).length === 4, body);

    // THE POINT. JSON.stringify must emit 3, not "3" - the wire format is what
    // was wrong, and only serialising it proves the fix.
    const wire = JSON.stringify(body);
    ok('the SERIALISED body sends a bare number', /"scanType":3(,|})/.test(wire), wire);
    ok('  and not a quoted string', !/"scanType":"/.test(wire), wire);

    const overridden = cardRequestBody({ cardNumber: '1', surname: 'Z', schemeId: 'C4T' }, 1);
    ok('the probe can override it', overridden[REQUEST_SHAPE.fields.scanType] === 1, overridden);
    ok('  and the override also serialises as a number',
      /"scanType":1(,|})/.test(JSON.stringify(overridden)), JSON.stringify(overridden));

    // The live path describes how WE captured the card. 1 and 2 are scanning
    // methods SiteComply does not have; claiming one would be a false statement
    // to a partner about provenance.
    ok('the live path only ever claims manual entry', REQUEST_SHAPE.scanType === 3);

    let msg = '';
    try { cardRequestBody({ cardNumber: '', surname: '', schemeId: '' }); } catch (e) { msg = (e as Error).message; }
    ok('the refusal does not blame the worker for the scan type', !/scan/i.test(msg), msg);
  }

  // ── 25. the service's own words are surfaced ───────────────────────────
  {
    const body = JSON.stringify({
      responseMethod: 'card', responseCode: '400',
      responseMessage: 'Scan type is required', errorCode: 'VAL_002',
      responseData: null,
    });
    const m = envelopeMessage(body)!;
    ok('the service message is extracted', /Scan type is required/.test(m), m);
    ok('  with its error code', /VAL_002/.test(m), m);
    ok('  and its response code', /400/.test(m), m);
    ok('a non-JSON body yields nothing', envelopeMessage('<html>') === undefined);
    ok('an empty body yields nothing', envelopeMessage('') === undefined);

    const v = classifySmartCheckResponse(400, body, HOST, {
      scanTypes: ['MANUAL → 400 responseMessage: Scan type is required'],
      acceptedScanType: null,
    });
    ok('a 400 quotes the service verbatim', /Scan type is required/.test(v.detail), v.detail);
    ok('  lists the scan types tried', /Scan types tried:/.test(v.detail), v.detail);
    // Was "concludes the FIELD NAME is wrong". That conclusion was only sound
    // while the field was never reaching validation; the sentinel now answers
    // the same question with evidence instead of inference.
    ok('  states plainly that nothing was accepted',
      /No candidate was accepted/.test(v.detail), v.detail);

    const v2 = classifySmartCheckResponse(400, body, HOST, {
      scanTypes: ['3 -> 400 ...', '1 -> 400 Something else is required'],
      acceptedScanType: 1,
    });
    ok('an accepted scan type is called out as the finding',
      /accepted scanType 1/.test(v2.detail), v2.detail);
    ok('  and names the line to change', /REQUEST_SHAPE.scanType/.test(v2.detail), v2.detail);
  }

  // ── 26. the control request: is the 403 ours or theirs? ────────────────
  {
    const refusedToo = classifySmartCheckResponse(403, '', HOST, {
      tried: CANDIDATE_AUTH_PRESENTATIONS.map((p) => `${p.label} → 403`),
      controlResult: '403',
    });
    ok('a control that is ALSO refused clears the integration',
      /not caused by anything this integration changed/.test(refusedToo.detail), refusedToo.detail);
    ok('  and says what the control was', /WITHOUT scanType returned 403/.test(refusedToo.detail), refusedToo.detail);

    const differed = classifySmartCheckResponse(403, '', HOST, {
      tried: ['Bearer <token> + x-api-key → 403'],
      controlResult: '400 responseMessage: Scan type is required',
    });
    ok('a control that behaves DIFFERENTLY points back at our request',
      /follows from the request this integration now sends/.test(differed.detail), differed.detail);
    ok('  and does not blame CSCS authorisation',
      !/not caused by anything this integration changed/.test(differed.detail), differed.detail);
    ok('  quoting the control\'s own message',
      /Scan type is required/.test(differed.detail), differed.detail);

    // ── the sentinel: the experiment that separates the two explanations ──
    const validated = classifySmartCheckResponse(403, '', HOST, {
      scanTypes: ['MANUAL → 403', 'NOT_A_REAL_SCAN_TYPE (deliberately invalid) → 400'],
      sentinelStatus: 400,
    });
    ok('nonsense drawing a 400 means the field IS read',
      /field name is right and the service IS reading the value/.test(validated.detail), validated.detail);
    ok('  so a 403 for a real value is a permission question for CSCS',
      /which scan types this key is entitled to use/.test(validated.detail), validated.detail);

    const presenceIsEnough = classifySmartCheckResponse(403, '', HOST, {
      scanTypes: ['MANUAL → 403', 'NOT_A_REAL_SCAN_TYPE (deliberately invalid) → 403'],
      sentinelStatus: 403,
    });
    ok('nonsense ALSO drawing 403 means the value is not the story',
      /does not depend on WHAT the field contains/.test(presenceIsEnough.detail), presenceIsEnough.detail);
    ok('  and it does not then blame the value',
      !/entitled to use/.test(presenceIsEnough.detail), presenceIsEnough.detail);

    const noSentinel = classifySmartCheckResponse(403, '', HOST, {
      scanTypes: ['MANUAL → 403'],
    });
    ok('with no sentinel run, neither conclusion is drawn',
      !/deliberately invalid/.test(noSentinel.detail), noSentinel.detail);

    const none = classifySmartCheckResponse(403, '', HOST, { tried: ['x → 403'] });
    ok('with no control run, nothing is claimed either way',
      !/CONTROL/.test(none.detail), none.detail);
  }

  // ── 26b. the control must actually BE sent, and BE a control ───────────
  // Mutation testing found both of these missing: every assertion above fed
  // classifySmartCheckResponse a controlResult by hand, so deleting the code
  // that produces one changed nothing. The wiring needs its own guard.
  {
    const src = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
    const block = src.slice(src.indexOf('THE CONTROL.'), src.indexOf('res = attempt as Response;'));
    ok('the control is sent when the card call is refused',
      /attempt\.status === 401 \|\| attempt\.status === 403/.test(block), 'gate missing');
    ok('  and it goes through the timeout helper', /await cardFetch\(/.test(block), 'not using cardFetch');
    ok('  and its result is recorded', /controlResult = /.test(block), 'never recorded');

    // The control exists to isolate ONE variable. If it sends scanType it is
    // not a control, it is a second identical request.
    const body = block.slice(block.indexOf('cardFetch('), block.indexOf('authHeaders'));
    ok('the control body carries the three identifying fields',
      ['schemeId', 'surname', 'registrationNumber'].every((f) => body.includes(`fields.${f}`)), body);
    ok('  and NOT scanType — that is the variable being isolated',
      !body.includes('fields.scanType'), body);
  }

  // ── 26c. the walk must fire even when the service says nothing ─────────
  // The original trigger required the reply to mention "scan type". Supplying
  // scanType returns 403 with an EMPTY body, so the walk never ran and MANUAL
  // was the only value ever tried against the live service.
  {
    const src = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
    const walk = src.slice(src.indexOf('WALK THE SCAN TYPES ON ANY 4xx'), src.indexOf('THE CONTROL.'));
    ok('the walk triggers on any 4xx',
      /attempt\.status >= 400 && attempt\.status < 500/.test(walk), 'trigger missing');
    ok('  not on the reply mentioning "scan type"',
      !/if \(\/scan\\s\*type\/i\.test\(firstBody\)\)/.test(walk), 'body-text trigger still there');
    // Not just "the name appears in the block" — it appears in the adoption
    // guard too, so that passed even with the sentinel removed from the loop.
    // Assert it is in the ITERABLE.
    ok('the sentinel is in the list the walk iterates',
      /for \(const candidate of \[SCAN_TYPE_SENTINEL, \.\.\.CANDIDATE_SCAN_TYPES\]\)/.test(walk),
      'sentinel not in the loop iterable');
    ok('  and is never adopted as a real value',
      /never adopt the sentinel/.test(walk) && /sentinelStatus = next\.status;[\s\S]{0,60}continue;/.test(walk),
      'sentinel could be adopted');
    ok('a candidate is only adopted when it stops failing',
      /if \(next\.status < 400\) \{/.test(walk), 'adoption rule missing');
    ok('the sentinel is not in the live candidate list',
      !CANDIDATE_SCAN_TYPES.includes(SCAN_TYPE_SENTINEL), CANDIDATE_SCAN_TYPES);
    ok('  and is far outside the documented range 1-3',
      SCAN_TYPE_SENTINEL > 3, SCAN_TYPE_SENTINEL);
  }

  // ── 27. one timeout per request, not one across all of them ────────────
  {
    const src = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
    const stage2 = src.slice(src.indexOf('STAGE 2 — ask about a card'));
    ok('the card fetches go through a per-request helper',
      /const cardFetch = async \(/.test(stage2), 'helper missing');
    ok('  which arms its own controller', /cardFetch = async[\s\S]{0,400}new AbortController\(\)/.test(stage2));
    ok('  and clears it', /cardFetch = async[\s\S]{0,700}clearTimeout\(abort\)/.test(stage2));
    // The helper contains the only raw fetch; every call site must go through
    // it, or that call site has no timeout of its own.
    const rawFetches = (stage2.match(/await fetch\(target\.toString\(\)/g) ?? []).length;
    ok('exactly one raw fetch in the card stage — the helper\'s own',
      rawFetches === 1, `${rawFetches} raw fetches`);
    const helperBody = stage2.slice(stage2.indexOf('const cardFetch = async ('), stage2.indexOf('  };', stage2.indexOf('const cardFetch = async (')));
    ok('  and it is inside the helper', /await fetch\(target\.toString\(\)/.test(helperBody));
    ok('every card call site uses the helper',
      (stage2.match(/await cardFetch\(/g) ?? []).length >= 3,
      `${(stage2.match(/await cardFetch\(/g) ?? []).length} call sites`);
  }

  // ── 27b. the other documented cards: sent, and reported ────────────────
  // Mutation testing found all four of these missing — the ladder was built and
  // asserted nowhere, so deleting the loop, the report, or the conclusion
  // changed nothing. The same gap as the control and the sentinel before it.
  {
    const src = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
    /*
     * Anchor on the LOOP, not on the comment.
     *
     * "THE OTHER DOCUMENTED CARDS." also appears in an earlier doc-comment, so
     * slicing from it started above probeBody and swallowed probeBody's own
     * surname line — which satisfied the one-variable check no matter what the
     * alternate request actually sent. Mutation testing caught it; reading would
     * not have.
     */
    const loopAt = src.indexOf('for (const registration of ALTERNATE_REGISTRATIONS)');
    const block = src.slice(
      src.lastIndexOf('if (attempt &&', loopAt),
      src.indexOf('THE CONTROL.', loopAt),
    );
    ok('the guard is reading the alternate-card block only',
      block.includes('registration') && !block.includes('scanType]: scanType'), block.slice(0, 120));
    ok('the alternates are only tried when the first was refused',
      /attempt\.status === 401 \|\| attempt\.status === 403/.test(block), 'gate missing');
    ok('  and the loop actually iterates them',
      /for \(const registration of ALTERNATE_REGISTRATIONS\)/.test(block), 'not iterating');
    ok('  through the timeout helper', /await cardFetch\(/.test(block), 'raw fetch');
    ok('  recording each result', /cardsTried\.push\(/.test(block), 'not recorded');

    // ONE VARIABLE AT A TIME. Changing the surname as well would make a
    // different answer uninterpretable.
    ok('only the registration number varies',
      /surname\]: PROBE_CARD\.surname/.test(block) &&
      /registrationNumber\]: registration/.test(block) &&
      /schemeId\]: PROBE_CARD\.schemeId/.test(block), block.slice(0, 300));

    ok('three alternates, all documented', ALTERNATE_REG_COUNT === 3, ALTERNATE_REG_COUNT);

    // …and the verdict states what the ladder showed.
    const allRefused = classifySmartCheckResponse(403, '', HOST, {
      cardsTried: ['13285326 -> 403', '14661856 -> 403', '14662192 -> 403'],
    });
    ok('four identical refusals is called out as not card-specific',
      /not about a particular record/.test(allRefused.detail), allRefused.detail);
    ok('  listing each registration', /13285326/.test(allRefused.detail) && /14662192/.test(allRefused.detail));

    const mixed = classifySmartCheckResponse(403, '', HOST, {
      cardsTried: ['13285326 -> 403', '14661856 -> 200 ok', '14662192 -> 403'],
    });
    ok('a differing card overturns the blanket reading',
      /the record matters and this is not a blanket refusal/.test(mixed.detail), mixed.detail);
    ok('  and does NOT claim a blanket refusal',
      !/not about a particular record/.test(mixed.detail), mixed.detail);

    const none = classifySmartCheckResponse(403, '', HOST, {});
    ok('with no ladder run, neither conclusion is drawn',
      !/documented test registrations/.test(none.detail), none.detail);
  }

  // ── 27c. the wire names the service itself asked for ───────────────────
  {
    ok('the scheme field is named schemeIdentifier',
      REQUEST_SHAPE.fields.schemeId === 'schemeIdentifier', REQUEST_SHAPE.fields);
    ok('the card number field is named cardSerialNumber',
      REQUEST_SHAPE.fields.registrationNumber === 'cardSerialNumber', REQUEST_SHAPE.fields);
    ok('  the Test Cards page vocabulary is NOT on the wire',
      !Object.values(REQUEST_SHAPE.fields).includes('registrationNumber') &&
      !Object.values(REQUEST_SHAPE.fields).includes('schemeId'), REQUEST_SHAPE.fields);
    ok('scanType keeps the casing the service accepted',
      REQUEST_SHAPE.fields.scanType === 'scanType');
    // surname has never been objected to, but the service names only what is
    // MISSING - so it is not confirmed, and the flag must not pretend otherwise.
    ok('the field set is still NOT claimed confirmed',
      REQUEST_SHAPE.fieldsConfirmed === false);

    const wire = JSON.stringify(cardRequestBody({ cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' }));
    ok('the serialised body uses the service\'s own names',
      /"schemeIdentifier":"C4T"/.test(wire) && /"cardSerialNumber":"14660726"/.test(wire), wire);
    ok('  and still sends scanType as a number', /"scanType":3/.test(wire), wire);

    ok('the first candidate naming is what the live path sends',
      CANDIDATE_FIELD_NAMINGS[0]?.schemeId === REQUEST_SHAPE.fields.schemeId &&
      CANDIDATE_FIELD_NAMINGS[0]?.registrationNumber === REQUEST_SHAPE.fields.registrationNumber &&
      CANDIDATE_FIELD_NAMINGS[0]?.surname === REQUEST_SHAPE.fields.surname,
      CANDIDATE_FIELD_NAMINGS[0]);
    ok('  the candidates are distinct',
      new Set(CANDIDATE_FIELD_NAMINGS.map((n) => `${n.schemeId}|${n.surname}|${n.registrationNumber}`)).size
        === CANDIDATE_FIELD_NAMINGS.length, CANDIDATE_FIELD_NAMINGS.length);
    ok('  and one of them varies the surname casing',
      CANDIDATE_FIELD_NAMINGS.some((n) => n.surname === 'surName'), CANDIDATE_FIELD_NAMINGS.map((n) => n.surname));

    const accepted = classifySmartCheckResponse(400, '{"responseMessage":"x"}', HOST, {
      namingsTried: ['a -> 400 missing', 'b -> 200 ok'],
      acceptedNaming: 'b',
    });
    ok('an accepted naming is called out as the finding',
      /accepted "b" - set REQUEST_SHAPE.fields to match/.test(accepted.detail), accepted.detail);
    const rejected = classifySmartCheckResponse(400, '{"responseMessage":"x"}', HOST, {
      namingsTried: ['a -> 400 missing', 'b -> 400 missing'],
    });
    ok('none accepted says so plainly',
      /None was accepted/.test(rejected.detail), rejected.detail);
    ok('  and lists what was tried', /Field namings tried:/.test(rejected.detail), rejected.detail);
    const noProbe = classifySmartCheckResponse(400, '{"responseMessage":"x"}', HOST, {});
    ok('with no naming probe, nothing is claimed',
      !/Field namings tried/.test(noProbe.detail), noProbe.detail);

    // The probe must be able to vary the names; a probeBody that ignored its
    // argument would report a ladder every rung of which was the same request.
    const src = readFileSync('services/cscs/smartCheckConnectionTest.ts', 'utf8');
    const pb = src.slice(src.indexOf('const probeBody = ('), src.indexOf('const probeBody = (') + 500);
    ok('probeBody honours the naming it is given',
      /\[naming\.schemeId\]/.test(pb) && /\[naming\.registrationNumber\]/.test(pb) && /\[naming\.surname\]/.test(pb), pb);
  }

  // ── 28. the diagnostic has to be COPYABLE ──────────────────────────────
  // The owner could not paste the result because it contained ->, - and ...
  // as typographic characters. A diagnostic that has to be retyped is half a
  // diagnostic, and this one has to travel to CSCS.
  {
    const nonAsciiInOutput = (file: string) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
        })
        .filter((l) => /[^\x00-\x7F]/.test(l));
    for (const f of [
      'services/cscs/smartCheckConnectionTest.ts',
      'services/cscs/smartCheckAuth.ts',
    ]) {
      const bad = nonAsciiInOutput(f);
      ok(`${f}: output strings are plain ASCII`, bad.length === 0, bad.slice(0, 2));
    }
    ok('the status separator is ASCII', /-> /.test(String(classifySmartCheckResponse(403, '', HOST, { tried: ['x -> 403'] }).detail)));
  }

  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
