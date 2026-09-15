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
} from '../services/cscs/smartCheckConnectionTest';
import { CANDIDATE_AUTH_PRESENTATIONS, authHeaders } from '../services/cscs/smartCheckAuth';
import { REQUEST_SHAPE, cardRequestBody } from '../services/cscs/smartCheckProvider';
import {
  CANDIDATE_FIELD_SHAPES,
  AUTH_SHAPE,
  keptHeaders,
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
    ok('the summary is capped', shapeSummary({ big: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, 'x'])) }).length <= 901);
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
    ok('the request is built from the three documented parts',
      JSON.stringify(Object.keys(REQUEST_SHAPE.fields).sort()) ===
        '["registrationNumber","schemeId","surname"]', REQUEST_SHAPE.fields);
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
    ok('  and nothing else', Object.keys(body).length === 3, body);

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

  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
