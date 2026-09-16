import { CscsVerifyError } from './CscsProvider';
import { redact } from '@/services/telemetry/errorLog';

/**
 * Smart Check V2.6 authentication (SC-001 Phase 2).
 *
 * V2.6 is a TWO-STEP protocol: POST /authenticate with username, password and
 * the API key to obtain a token, then validate cards with that token. The
 * previous implementation assumed a single API key sent straight on the
 * validate call — the wrong KIND of auth, not merely the wrong header name.
 *
 * Separate from the provider for the same reason reportMailer is separate from
 * reportDelivery: transport concerns should not be tangled with what a card
 * verification means.
 *
 * WHAT IS KNOWN, AND WHAT IS NOT (as at 2026-09-15)
 *
 *   KNOWN      the protocol, the base URL, and the /authenticate response:
 *              `responseData` wrapping userName, userId, idToken, accessToken
 *              and itPartner, with NO expiry field of any kind.
 *   NOT KNOWN  whether the Authorization header wants a bare token or a
 *              "Bearer " prefix, and whether x-api-key travels with it. Both
 *              live in AUTH_SHAPE and nowhere else.
 *
 * Nothing here guesses silently: if the response does not carry a recognisable
 * token the call FAILS with a clear message rather than proceeding with
 * undefined, which would surface later as a baffling 401 on the card call.
 */

/**
 * The one place the partner's authentication contract is encoded.
 *
 * CONFIRMED against V2.6 (2026-09-15). The lists that used to hedge across
 * synonyms have been cut to the documented values, because a hedge is only
 * useful while the answer is unknown — after that it is a way to silently pick
 * the wrong one.
 */
export const AUTH_SHAPE = {
  /** Appended to the configured base URL. */
  path: '/authenticate',
  method: 'POST' as const,
  /** The API key header. V2.6 uses x-api-key, not Authorization. */
  apiKeyHeader: 'x-api-key',
  /**
   * Request body field names.
   *
   * CONFIRMED EMPIRICALLY 2026-09-15: `userName` with a capital N, matching the
   * casing the response uses. Lowercase `username` produced HTTP 200 with a
   * zero-length body — the request cleared the gateway, the backend parsed it,
   * found no credentials where it expected them, and answered with nothing.
   *
   * The connection test's candidate probe established this against the live
   * service and REPORTED it; this line is the deliberate change that followed,
   * so the live verification path sends the same shape the test proved. Leaving
   * it lowercase would have meant a test that passes and check-ins that fail.
   */
  fields: { username: 'userName', password: 'password' },
  /**
   * Who we say we are.
   *
   * Node's fetch sends `user-agent: node` when nothing is set. An unidentified
   * agent is both poor manners toward a partner and a plausible trigger for bot
   * mitigation, and it gives CSCS support nothing to search their logs for.
   */
  userAgent: 'SiteComply/1.0 (+https://sitecomply.co.uk)',
  /** The documented wrapper. V2.6 returns everything under `responseData`. */
  responseWrappers: ['responseData'],
  /**
   * The token the CARD endpoint wants: `idToken`.
   *
   * V2.6 returns BOTH `idToken` and `accessToken`, and the card endpoint's
   * documentation names idToken. This list is deliberately one entry: an
   * earlier version tried accessToken first, which would have authenticated
   * successfully and then failed the card call with 401 — reported as "Smart
   * Check rejected our credentials" while the credentials were perfectly fine.
   *
   * Do NOT add accessToken as a fallback. If idToken ever stops being present
   * that is a contract change worth failing loudly on, not one to paper over by
   * quietly sending the other token.
   */
  tokenFields: ['idToken'],
  /**
   * V2.6 documents NO expiry field — not expiresIn, expiresAt, ttl or
   * tokenType. The lists stay only so an undocumented field would still be
   * honoured if one appears. With none present, the assumed lifetime below
   * applies and the 401-retry in the provider is what actually handles a stale
   * token. That is the primary staleness mechanism here, not a safety net.
   */
  expiryFields: ['expiresIn', 'expires_in', 'ttl'],
  expiryAtFields: ['expiresAt', 'expires_at', 'expiry'],
  /**
   * How the token is presented on subsequent calls.
   *
   * The documentation says the Authorization header "should contain the token
   * returned by authentication", which does not say whether it wants a bare
   * token or the conventional `Bearer ` scheme. Bearer is the common reading
   * and is the default here; if the card call returns 401 after a SUCCESSFUL
   * sign-in, this prefix is the first thing to try emptying. The connection
   * test says so in its own words when that happens.
   */
  tokenHeader: 'Authorization',
  tokenPrefix: 'Bearer ',
  /**
   * Whether the API key must ALSO be sent on the card call alongside the token.
   * Sending it when it is not required is harmless; omitting it when it is
   * required produces a 401 that looks like bad credentials, so this defaults to
   * sending it. Confirm against the documentation.
   */
  sendApiKeyWithToken: true,
};

/**
 * Body shapes to try when the service answers 2xx with nothing.
 *
 * FOR THE CONNECTION TEST ONLY. The live verification path uses AUTH_SHAPE and
 * nothing else — it must be deterministic, and a provider that quietly tries
 * several shapes would hide a contract change instead of reporting it.
 *
 * This is not guessing: the test REPORTS which shape the service accepted, and
 * the answer then gets written into AUTH_SHAPE.fields deliberately. The first
 * entry is what we send today, so a run that succeeds on entry one proves the
 * current shape is right.
 *
 * Kept to two because each entry is another credential submission against a
 * partner whose lockout policy we do not know.
 */
export const CANDIDATE_FIELD_SHAPES: {
  label: string;
  fields: { username: string; password: string };
}[] = [
  // First is what AUTH_SHAPE sends, so a run that succeeds here proves the live
  // shape is right. Since 2026-09-15 that is userName, which the probe itself
  // established.
  { label: 'userName / password', fields: { username: 'userName', password: 'password' } },
  { label: 'username / password', fields: { username: 'username', password: 'password' } },
];

/**
 * Ways the token can be presented to the card endpoint.
 *
 * Two unknowns, so four combinations: bare token versus the "Bearer " scheme,
 * and whether x-api-key travels alongside. The first entry is what AUTH_SHAPE
 * sends today, so a run that succeeds there proves the live settings are right.
 *
 * SAFE TO PROBE, unlike the sign-in shapes. These carry no credentials — only a
 * token already obtained — and ask about a synthetic all-zero card number, so a
 * failed attempt costs nothing and cannot lock an account out. That is why this
 * list is exhaustive where CANDIDATE_FIELD_SHAPES was capped at two.
 */
export const CANDIDATE_AUTH_PRESENTATIONS: {
  label: string;
  prefix: string;
  sendApiKey: boolean;
}[] = [
  { label: 'Bearer <token> + x-api-key', prefix: 'Bearer ', sendApiKey: true },
  { label: 'bare <token> + x-api-key', prefix: '', sendApiKey: true },
  { label: 'Bearer <token>, no x-api-key', prefix: 'Bearer ', sendApiKey: false },
  { label: 'bare <token>, no x-api-key', prefix: '', sendApiKey: false },
];

/** Refresh this long before the stated expiry, so a call never races it. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;
/** A token with no stated lifetime is assumed good for this long. */
const ASSUMED_LIFETIME_MS = 10 * 60_000;
/**
 * Sign-in gets longer than a card lookup.
 *
 * 15s was inherited from the card call. A first authentication against a
 * partner API has no warm connection and may do real work, and an abort at 15s
 * surfaces as "could not reach" — indistinguishable from the host being down.
 * Better to wait than to misreport.
 */
const TIMEOUT_MS = 30_000;

/**
 * WHY THE SIGN-IN FAILED, as data rather than as a sentence.
 *
 * The connection test used to work out what had happened by running regular
 * expressions over the message text, and anything it did not recognise fell into
 * "could not reach the host". So "signed in but the body was not JSON" — which
 * PROVES the host was reached and answered — was reported as an unreachable
 * host, and two rounds of diagnosis went looking for a network fault that did
 * not exist.
 *
 * A classifier that reads prose is a classifier that silently misfiles the case
 * nobody thought of. This is the kind, explicitly.
 *
 *   transport   no HTTP response at all — DNS, TLS, refused, timeout.
 *   rejected    401/403. The credentials were seen and refused.
 *   http        any other non-2xx. The service answered; it said no.
 *   unreadable  2xx whose body would not parse as JSON.
 *   no-token    parsed fine, but carried no token we recognise.
 */
export type SmartCheckAuthFailureKind =
  | 'transport'
  | 'rejected'
  | 'http'
  | 'unreadable'
  | 'no-token';

export interface SmartCheckAuthFailure {
  kind: SmartCheckAuthFailureKind;
  /** HTTP status, when there was a response. */
  status?: number;
  /** Declared content type, which is often the giveaway on an unreadable body. */
  contentType?: string;
  /** Length of the body in bytes. Zero is a real and informative answer. */
  bodyBytes?: number;
  /** A short, redacted excerpt. Never the whole body, never a token. */
  bodySnippet?: string;
  /** undici's error code on a transport failure (ENOTFOUND, ECONNREFUSED…). */
  code?: string;
  /**
   * A handful of response headers, by name.
   *
   * `x-amzn-requestid` and `x-amz-apigw-id` are the identifiers CSCS support
   * can trace a single request by — worth more than any amount of guessing
   * from this side. `x-amzn-errortype` says whether the ANSWER came from the
   * API gateway or from the service behind it, which is the difference between
   * "our credentials were refused" and "the service ran and returned nothing".
   */
  responseHeaders?: Record<string, string>;
  /** Which body field names produced this result. */
  fieldShape?: string;
  /** The parsed response rendered as structure, with values masked. */
  responseShape?: string;
  /** True when the request was aborted by our own timeout. */
  timedOut?: boolean;
}

/**
 * A sign-in failure that knows what it was.
 *
 * Still a CscsVerifyError, so every existing catch — the provider's included —
 * behaves exactly as before. The extra field is additive.
 */
export class SmartCheckAuthError extends CscsVerifyError {
  constructor(
    message: string,
    readonly failure: SmartCheckAuthFailure,
    cause?: unknown,
    retryable = false,
  ) {
    super(message, cause, retryable);
    this.name = 'SmartCheckAuthError';
  }
}

/**
 * How much of a response body may be shown to an admin.
 *
 * Enough to recognise an AWS error envelope or an HTML error page; far too
 * little to be a useful copy of anything. Redacted with the same rules the error
 * log uses, because a 2xx body that failed to parse could still be a SUCCESS
 * body — one containing a token — arriving in a shape we did not expect.
 */
const MAX_SNIPPET = 300;

/**
 * Response headers an admin may see.
 *
 * An ALLOW-LIST, not a block-list. A partner can set any header it likes,
 * including ones that echo a credential, so the safe default is to keep
 * nothing and name the exceptions.
 */
const KEEP_HEADERS = [
  'content-length',
  'content-encoding',
  'x-amzn-requestid',
  'x-amzn-errortype',
  'x-amz-apigw-id',
  'x-cache',
  'server',
  'via',
];

export function keptHeaders(h: Headers): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of KEEP_HEADERS) {
    const v = h.get(name);
    if (v) out[name] = v.slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Envelope fields whose VALUES are safe to show, and are the diagnosis.
 *
 * A partner that wraps its answer in responseCode / responseMessage / errorCode
 * is reporting application-level outcomes INSIDE an HTTP 200 — "invalid
 * credentials" and "success" arrive with the same status line. Masking those
 * values would hide the only sentence that says which happened.
 *
 * Everything not on this list is reduced to its type and size. The list holds
 * no field that could carry a credential, and the values still pass through
 * redact() in case a message quotes a user.
 */
const SAFE_VALUE_FIELDS = new Set([
  'responseCode',
  'responseMessage',
  'responseMethod',
  'errorCode',
  'errorMessage',
  'status',
  'statusCode',
  'message',
  'error',
  'success',
]);

const SHAPE_MAX_DEPTH = 6;
const SHAPE_MAX_KEYS = 40;
const SHAPE_MAX_CHARS = 900;

/**
 * Render a parsed response as its STRUCTURE, with values masked.
 *
 * Keys at every depth, because "no token was found" is unanswerable without
 * knowing what the response actually contained and where. Strings become
 * <string, N chars> — enough to recognise a 900-character JWT from a 3-letter
 * status code without printing either.
 */
export function describeShape(v: unknown, depth = 0, key = ''): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) {
    if (depth >= SHAPE_MAX_DEPTH) return `<array, ${v.length} items>`;
    return v.length === 0
      ? '[]'
      : `[${describeShape(v[0], depth + 1, key)}${v.length > 1 ? `, ...${v.length - 1} more` : ''}]`;
  }
  if (typeof v === 'object') {
    if (depth >= SHAPE_MAX_DEPTH) return '<object>';
    const keys = Object.keys(v as Record<string, unknown>);
    const shown = keys.slice(0, SHAPE_MAX_KEYS);
    const body = shown
      .map((k) => `${k}: ${describeShape((v as Record<string, unknown>)[k], depth + 1, k)}`)
      .join(', ');
    const more = keys.length > shown.length ? `, ...${keys.length - shown.length} more` : '';
    return `{${body}${more}}`;
  }
  if (typeof v === 'string') {
    // The envelope's own words, or the shape of the value. Never both.
    if (SAFE_VALUE_FIELDS.has(key)) {
      return JSON.stringify(redact(v).slice(0, 120));
    }
    /*
     * A payload nested as a STRING is a real and easy-to-miss shape — plenty of
     * Java and AWS services return `responseData` as stringified JSON. Masked
     * flat it reads as <string, 812 chars>, indistinguishable from a token, and
     * the fields inside it would never be seen. Described, the renaming or
     * renesting is obvious at a glance. The inner values stay masked.
     */
    if (depth < SHAPE_MAX_DEPTH && /^\s*[[{]/.test(v)) {
      try {
        return `<json string, ${v.length} chars> ${describeShape(JSON.parse(v), depth + 1, key)}`;
      } catch {
        /* not JSON after all; fall through to the plain mask */
      }
    }
    return `<string, ${v.length} chars>`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return SAFE_VALUE_FIELDS.has(key) ? String(v) : `<${typeof v}>`;
  }
  return `<${typeof v}>`;
}

/**
 * The partner's own explanation, pulled out of its envelope.
 *
 * This service reports validation failures in `responseMessage` — "Scan type is
 * required" was worth more than any inference we could have drawn from the 400
 * alone. Surfacing it verbatim turns each attempt into a statement of what is
 * still missing, so one run can answer several questions instead of one.
 *
 * Only the allow-listed envelope fields, and still redacted.
 */
export function envelopeMessage(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const row = parsed as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['responseMessage', 'errorMessage', 'message', 'errorCode', 'responseCode']) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) parts.push(`${k}: ${redact(v).slice(0, 160)}`);
    else if (typeof v === 'number') parts.push(`${k}: ${v}`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

/** describeShape, capped for a message an admin reads on one screen. */
export function shapeSummary(v: unknown): string {
  const text = describeShape(v);
  return text.length > SHAPE_MAX_CHARS ? `${text.slice(0, SHAPE_MAX_CHARS)}...` : text;
}

/**
 * Every path whose KEY looks like it could hold a token.
 *
 * Reports, never adopts. If the partner renamed idToken, this says exactly
 * where it went and AUTH_SHAPE.tokenFields gets corrected by hand — picking one
 * automatically would be the accessToken mistake again, where the wrong token
 * authenticates and then fails the card call as "bad credentials".
 */
export function tokenLikePaths(v: unknown, path = '', depth = 0): string[] {
  if (depth >= SHAPE_MAX_DEPTH) return [];
  // Look inside a stringified payload, for the same reason describeShape does.
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try {
      return tokenLikePaths(JSON.parse(v), path, depth + 1);
    } catch {
      return [];
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const out: string[] = [];
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (/token|jwt|bearer|credential|session/i.test(k)) {
      out.push(
        typeof val === 'string' ? `${here} (string, ${val.length} chars)` : `${here} (${val === null ? 'null' : typeof val})`,
      );
    }
    out.push(...tokenLikePaths(val, here, depth + 1));
  }
  return out;
}

export function bodySnippet(text: string): string | undefined {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  const safe = redact(collapsed)
    // Redact anything long enough to be a credential even if it is not shaped
    // like one of redact()'s known patterns. A 40-character run in an
    // unparseable body is far more likely to be a secret than a useful clue.
    .replace(/[A-Za-z0-9._\-+/=]{40,}/g, '[long value]');
  return safe.length > MAX_SNIPPET ? `${safe.slice(0, MAX_SNIPPET)}...` : safe;
}

export interface SmartCheckCredentials {
  apiUrl: string;
  apiKey: string;
  username: string;
  password: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Cache keyed by credentials, not global.
 *
 * The connection test runs against UNSAVED credentials while the live provider
 * uses the stored ones. A single global slot would let a test populate the cache
 * the live path then used, or the reverse, and the bug would present as
 * intermittent authentication failures.
 */
const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

const keyOf = (c: SmartCheckCredentials) =>
  `${c.apiUrl} ${c.username} ${c.apiKey}`;

/** Drop cached tokens. Used after a 401 and by tests. */
export function clearSmartCheckTokens(): void {
  cache.clear();
  inflight.clear();
}

function pick(payload: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    if (payload[n] !== undefined && payload[n] !== null) return payload[n];
  }
  // V2.6 nests everything under `responseData`.
  for (const wrapper of AUTH_SHAPE.responseWrappers) {
    const inner = payload[wrapper];
    if (inner && typeof inner === 'object') {
      for (const n of names) {
        const v = (inner as Record<string, unknown>)[n];
        if (v !== undefined && v !== null) return v;
      }
    }
  }
  return undefined;
}

function expiryFrom(payload: Record<string, unknown>, now: number): number {
  const seconds = pick(payload, AUTH_SHAPE.expiryFields);
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return now + seconds * 1000 - EXPIRY_SAFETY_MARGIN_MS;
  }
  const at = pick(payload, AUTH_SHAPE.expiryAtFields);
  if (typeof at === 'string' || typeof at === 'number') {
    const t = new Date(at).getTime();
    if (Number.isFinite(t) && t > now) return t - EXPIRY_SAFETY_MARGIN_MS;
  }
  // No stated lifetime. Assume a short one rather than forever: re-authenticating
  // occasionally is cheap, and a stale token produces a 401 on a real check-in.
  return now + ASSUMED_LIFETIME_MS;
}

/** Exchange credentials for a token. No caching: see getSmartCheckToken. */
export async function authenticate(
  creds: SmartCheckCredentials,
  /**
   * Override the body field names. Used ONLY by the connection test, which
   * probes candidate shapes when the service answers 2xx with nothing. The live
   * path never passes this, so it always sends AUTH_SHAPE.fields.
   */
  fields: { username: string; password: string } = AUTH_SHAPE.fields,
): Promise<{ token: string; expiresAt: number }> {
  const target = new URL(
    `${creds.apiUrl.replace(/\/+$/, '')}${AUTH_SHAPE.path}`,
  );
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      method: AUTH_SHAPE.method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [AUTH_SHAPE.apiKeyHeader]: creds.apiKey,
        // Node's fetch otherwise sends `user-agent: node`.
        'user-agent': AUTH_SHAPE.userAgent,
      },
      body: JSON.stringify({
        [fields.username]: creds.username,
        [fields.password]: creds.password,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    // SAY WHAT ACTUALLY HAPPENED. "Could not reach" covered a timeout, a DNS
    // failure and a TLS failure alike, so a 15-second abort read as the host
    // being unreachable when it was answering in under a second.
    //
    // The host and the error code, never the credentials: undici's messages
    // carry the URL, not the headers or body, so this is safe to log and to
    // show an admin.
    //
    // This is the ONLY branch that means the host was not reached. Everything
    // below here had an answer.
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    const code = err?.cause?.code;
    const aborted = err?.name === 'AbortError' || code === 'UND_ERR_ABORTED';
    throw new SmartCheckAuthError(
      aborted
        ? `Smart Check did not answer within ${TIMEOUT_MS / 1000} seconds (${target.host}).`
        : `Could not reach ${target.host} to sign in to Smart Check${code ? ` (${code})` : ''}.`,
      { kind: 'transport', code, timedOut: aborted, fieldShape: `${fields.username} / ${fields.password}` },
      e,
      true,
    );
  } finally {
    clearTimeout(abort);
  }

  /*
   * Read the body ONCE, as text, before deciding anything.
   *
   * res.json() discards the bytes on failure, so the old code could say "the
   * response was unreadable" and then had nothing to show for it — which is
   * precisely the case where the body is the whole diagnosis. The status,
   * the declared content type and its LENGTH are all evidence: this partner
   * answers some requests with an empty body and `content-type:
   * application/json` set anyway, and an empty body is exactly what makes
   * JSON.parse fail.
   */
  const contentType = res.headers.get('content-type') ?? undefined;
  const rawBody = await res.text().catch(() => '');
  const evidence = {
    status: res.status,
    contentType,
    bodyBytes: Buffer.byteLength(rawBody),
    bodySnippet: bodySnippet(rawBody),
    responseHeaders: keptHeaders(res.headers),
    fieldShape: `${fields.username} / ${fields.password}`,
  };

  if (res.status === 401 || res.status === 403) {
    throw new SmartCheckAuthError(
      'Smart Check rejected the username, password or API key.',
      { kind: 'rejected', ...evidence },
      undefined,
      false,
    );
  }
  if (!res.ok) {
    throw new SmartCheckAuthError(
      `Smart Check sign-in returned HTTP ${res.status}.`,
      { kind: 'http', ...evidence },
      undefined,
      res.status === 429 || res.status >= 500,
    );
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    throw new SmartCheckAuthError(
      // The status is IN the message now. "Unreadable" on its own reads like a
      // network fault; "HTTP 200 with an empty body" reads like what it is.
      `Smart Check answered HTTP ${res.status} but the body was not JSON (${evidence.bodyBytes} bytes${contentType ? `, ${contentType}` : ''}).`,
      { kind: 'unreadable', ...evidence },
      undefined,
      true,
    );
  }

  const token = pick(payload, AUTH_SHAPE.tokenFields);
  if (typeof token !== 'string' || !token) {
    // Do NOT proceed with an undefined token. It would fail later as a 401 on
    // the card call and read as a credentials problem rather than a shape one.
    //
    // The TOP-LEVEL KEYS are named, not the values. Which fields came back is
    // the answer to "is the request shape wrong", and none of them is a secret.
    const found = tokenLikePaths(payload);
    throw new SmartCheckAuthError(
      [
        `Smart Check answered HTTP ${res.status} but no token was found where the integration looks.`,
        `It looks for ${AUTH_SHAPE.tokenFields.join(' or ')} at the top level and inside ${AUTH_SHAPE.responseWrappers.join(', ')}.`,
        found.length
          ? `Token-like fields ARE present at: ${found.join('; ')}.`
          : 'No field anywhere in the response has a token-like name.',
        `Response shape (values masked): ${shapeSummary(payload)}`,
      ].join(' '),
      { kind: 'no-token', ...evidence, bodySnippet: undefined, responseShape: shapeSummary(payload) },
      undefined,
      false,
    );
  }

  return { token, expiresAt: expiryFrom(payload, Date.now()) };
}

/**
 * A valid token, from cache where possible.
 *
 * Single-flight: ten concurrent check-ins cause ONE authentication, not ten. A
 * partner API is a shared resource and a thundering herd against /authenticate
 * is a good way to get an account rate-limited.
 */
export async function getSmartCheckToken(
  creds: SmartCheckCredentials,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const key = keyOf(creds);
  const now = Date.now();

  if (opts.forceRefresh) {
    cache.delete(key);
    inflight.delete(key);
  } else {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.token;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const run = authenticate(creds)
    .then(({ token, expiresAt }) => {
      cache.set(key, { token, expiresAt });
      inflight.delete(key);
      return token;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, run);
  return run;
}

/** Headers to send on an authenticated Smart Check call. */
export function authHeaders(
  creds: SmartCheckCredentials,
  token: string,
  /**
   * Override how the token is presented. Used ONLY by the connection test's
   * probe; the live path passes nothing and always sends AUTH_SHAPE's settings.
   */
  presentation: { prefix: string; sendApiKey: boolean } = {
    prefix: AUTH_SHAPE.tokenPrefix,
    sendApiKey: AUTH_SHAPE.sendApiKeyWithToken,
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    [AUTH_SHAPE.tokenHeader]: `${presentation.prefix}${token}`,
    'user-agent': AUTH_SHAPE.userAgent,
  };
  if (presentation.sendApiKey) {
    headers[AUTH_SHAPE.apiKeyHeader] = creds.apiKey;
  }
  return headers;
}
