import { CscsVerifyError } from './CscsProvider';

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
 * WHAT IS KNOWN, AND WHAT IS NOT
 *
 *   KNOWN      the protocol shape: credentials in, token out, token used on the
 *              next call. Everything in this file implements that.
 *   NOT KNOWN  the exact response field names and the token header. They live
 *              in AUTH_SHAPE below and NOWHERE else, so confirming them against
 *              the partner documentation is an edit to one object.
 *
 * Nothing here guesses silently: if the response does not carry a recognisable
 * token the call FAILS with a clear message rather than proceeding with
 * undefined, which would surface later as a baffling 401 on the card call.
 */

/**
 * The one place the partner's authentication contract is encoded.
 *
 * `tokenFields` and `expiryFields` are lists because the documentation names one
 * of them and this code should not fail on a synonym — the same tolerance
 * smartCheckMapper already uses for card responses. Once the real names are
 * confirmed, cut each list down to the single correct value.
 */
export const AUTH_SHAPE = {
  /** Appended to the configured base URL. */
  path: '/authenticate',
  method: 'POST' as const,
  /** The API key header. V2.6 uses x-api-key, not Authorization. */
  apiKeyHeader: 'x-api-key',
  /** Request body field names. */
  fields: { username: 'username', password: 'password' },
  /** Response fields that may carry the token. */
  tokenFields: ['token', 'accessToken', 'access_token', 'idToken', 'jwt'],
  /** Response fields that may carry a lifetime in SECONDS. */
  expiryFields: ['expiresIn', 'expires_in', 'ttl'],
  /** Response fields that may carry an absolute expiry instant. */
  expiryAtFields: ['expiresAt', 'expires_at', 'expiry'],
  /** How the token is presented on subsequent calls. */
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

/** Refresh this long before the stated expiry, so a call never races it. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;
/** A token with no stated lifetime is assumed good for this long. */
const ASSUMED_LIFETIME_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;

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
  // Some APIs nest the token under a wrapper.
  for (const wrapper of ['data', 'result', 'auth']) {
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
      },
      body: JSON.stringify({
        [AUTH_SHAPE.fields.username]: creds.username,
        [AUTH_SHAPE.fields.password]: creds.password,
      }),
      signal: controller.signal,
    });
  } catch {
    // The host, never the credentials: this message can reach a log.
    throw new CscsVerifyError(
      `Could not reach ${target.host} to sign in to Smart Check.`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(abort);
  }

  if (res.status === 401 || res.status === 403) {
    throw new CscsVerifyError(
      'Smart Check rejected the username, password or API key.',
      undefined,
      false,
    );
  }
  if (!res.ok) {
    throw new CscsVerifyError(
      `Smart Check sign-in returned HTTP ${res.status}.`,
      undefined,
      res.status === 429 || res.status >= 500,
    );
  }

  const payload = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload) {
    throw new CscsVerifyError(
      'Smart Check sign-in returned an unreadable response.',
      undefined,
      true,
    );
  }

  const token = pick(payload, AUTH_SHAPE.tokenFields);
  if (typeof token !== 'string' || !token) {
    // Do NOT proceed with an undefined token. It would fail later as a 401 on
    // the card call and read as a credentials problem rather than a shape one.
    throw new CscsVerifyError(
      `Smart Check signed in but no token was found in the response. Expected one of: ${AUTH_SHAPE.tokenFields.join(', ')}.`,
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
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    [AUTH_SHAPE.tokenHeader]: `${AUTH_SHAPE.tokenPrefix}${token}`,
  };
  if (AUTH_SHAPE.sendApiKeyWithToken) {
    headers[AUTH_SHAPE.apiKeyHeader] = creds.apiKey;
  }
  return headers;
}
