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
  /** Request body field names. */
  fields: { username: 'username', password: 'password' },
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
  } catch (e) {
    // SAY WHAT ACTUALLY HAPPENED. "Could not reach" covered a timeout, a DNS
    // failure and a TLS failure alike, so a 15-second abort read as the host
    // being unreachable when it was answering in under a second.
    //
    // The host and the error code, never the credentials: undici's messages
    // carry the URL, not the headers or body, so this is safe to log and to
    // show an admin.
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    const code = err?.cause?.code;
    const aborted = err?.name === 'AbortError' || code === 'UND_ERR_ABORTED';
    throw new CscsVerifyError(
      aborted
        ? `Smart Check did not answer within ${TIMEOUT_MS / 1000} seconds (${target.host}).`
        : `Could not reach ${target.host} to sign in to Smart Check${code ? ` (${code})` : ''}.`,
      e,
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
