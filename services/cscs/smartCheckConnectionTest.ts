import { REQUEST_SHAPE } from './smartCheckProvider';
import {
  getSmartCheckToken,
  authHeaders,
  clearSmartCheckTokens,
} from './smartCheckAuth';

/**
 * SC-036 — CSCS Smart Check connection test.
 *
 * The Admin Centre equivalent of the SMS connectivity test: enter partner
 * credentials, prove they work, and only then select the provider. It closes
 * the self-service loop, because saveCscsConfig() REFUSES to select Smart Check
 * without credentials — so the natural order is enter → test → save, and until
 * now there was nothing to do in the middle.
 *
 * ── WHAT THIS ACTUALLY TESTS, AND WHAT IT CANNOT ──────────────────────────
 *
 * It performs one real request against the configured endpoint using the SAME
 * REQUEST_SHAPE that verifyCard() uses, and classifies the outcome. So it
 * proves, in order: the host resolves, TLS completes, the path exists, and the
 * API key is accepted.
 *
 * It does NOT prove the field names are right. The partner contract is still
 * unpublished (see smartCheckProvider.ts), so a 2xx here means "the service
 * accepted this request and answered" — not "the response was understood". The
 * result strings say exactly that rather than implying a clean bill of health;
 * claiming a verified integration on the strength of a 200 is how a broken
 * mapping reaches production wearing a green tick.
 *
 * This is also why the probe is worth having BEFORE the contract is known: if
 * REQUEST_SHAPE is wrong, this is the screen that says so, in the words of the
 * partner's own API, instead of a worker failing verification at a site gate.
 *
 * ── WHAT IT DOES NOT TOUCH ────────────────────────────────────────────────
 *
 * No worker, no card, no configuration and no verification logic. Nothing is
 * written to CscsVerificationLog: that table feeds the CSCS compliance report
 * and its export, and a connectivity probe against a synthetic card number is
 * not a worker verification. Putting it there would corrupt a compliance
 * figure to record an admin pressing a button. (The SMS test logs because a
 * test send costs money and reaches a real handset; neither applies here.)
 */

/** Shorter than the provider's 15s: this one has a human waiting on it. */
const TIMEOUT_MS = 10_000;

/**
 * The card number the probe submits.
 *
 * Synthetic and all-zero: it carries no personal data and belongs to no
 * worker. It is not expected to match any record — and if it somehow did, the
 * conclusion would be unchanged, because the test asks whether the service
 * answered, not what it answered.
 */
const PROBE_CARD_NUMBER = '00000000';

export type CscsConnectionOutcome =
  | 'OK'
  | 'CARD_NOT_FOUND'
  | 'UNAUTHORISED'
  | 'RATE_LIMITED'
  | 'REQUEST_REJECTED'
  | 'SERVICE_ERROR'
  | 'UNREADABLE_RESPONSE'
  | 'UNREACHABLE'
  | 'BLOCKED_URL'
  | 'NOT_CONFIGURED'
  /** Signed in, but the card endpoint then refused. Distinct from SIGN_IN_*. */
  | 'SIGN_IN_OK_CARD_FAILED'
  /** The credentials were rejected by /authenticate. */
  | 'SIGN_IN_REJECTED'
  /** Signed in, but no token could be found in the response. */
  | 'SIGN_IN_NO_TOKEN';

export interface CscsConnectionTestResult {
  outcome: CscsConnectionOutcome;
  /** True only when the service was reached, authenticated AND answered. */
  ok: boolean;
  /**
   * Three states, not two. A 404 is genuinely inconclusive and flattening it
   * into pass or fail would be a lie in one direction or the other.
   */
  severity: 'success' | 'warning' | 'error';
  /** One line, safe to display. Never contains the API key. */
  title: string;
  /**
   * Which half of V2.6 the result came from. Without this, "unauthorised" could
   * mean the credentials are wrong OR that sign-in worked and the card endpoint
   * refused — two different afternoons of debugging.
   */
  stage?: 'sign-in' | 'card-check';
  /** What it means and what to do next. */
  detail: string;
  httpStatus?: number;
  durationMs: number;
}

/**
 * Hosts a partner API can never legitimately be.
 *
 * This endpoint makes the SERVER fetch a URL an admin typed, so it is worth
 * refusing loopback, link-local (including the 169.254.169.254 cloud metadata
 * address) and RFC 1918 space rather than turning the settings screen into a
 * probe of the App Service's own network. The real Smart Check service is a
 * public host, so nothing legitimate is lost.
 */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) {
    return true;
  }
  if (h === '::1' || h === '0.0.0.0') return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (h.startsWith('fd') || h.startsWith('fe80')) return true; // IPv6 ULA/link-local
  return false;
}

/**
 * Run the probe.
 *
 * Never throws: a connection test that crashes tells the admin nothing. Every
 * failure is a classified result.
 */
export async function testSmartCheckConnection(credentials: {
  apiUrl: string;
  apiKey: string;
  username: string;
  password: string;
}): Promise<CscsConnectionTestResult> {
  const started = Date.now();
  const done = (
    r: Omit<CscsConnectionTestResult, 'durationMs'>,
  ): CscsConnectionTestResult => ({ ...r, durationMs: Date.now() - started });

  const apiUrl = (credentials.apiUrl ?? '').trim();
  const apiKey = (credentials.apiKey ?? '').trim();
  const username = (credentials.username ?? '').trim();
  const password = (credentials.password ?? '').trim();

  if (!apiUrl || !apiKey || !username || !password) {
    return done({
      outcome: 'NOT_CONFIGURED',
      ok: false,
      severity: 'error',
      title: 'Nothing to test yet.',
      detail:
        'Enter the partner API URL, API key, username and password above, then run the test. None of them needs to be saved first.',
    });
  }

  let target: URL;
  try {
    target = new URL(`${apiUrl.replace(/\/+$/, '')}${REQUEST_SHAPE.path}`);
  } catch {
    return done({
      outcome: 'BLOCKED_URL',
      ok: false,
      severity: 'error',
      title: 'The API URL is not a valid address.',
      detail: 'Enter the base URL issued by CSCS, for example https://api.example.co.uk.',
    });
  }

  // Same rule the save path applies: this request carries a partner credential.
  if (target.protocol !== 'https:') {
    return done({
      outcome: 'BLOCKED_URL',
      ok: false,
      severity: 'error',
      title: 'The API URL must use https://.',
      detail:
        'The request carries your partner API key, so it is never sent over an unencrypted connection.',
    });
  }
  if (isBlockedHost(target.hostname)) {
    return done({
      outcome: 'BLOCKED_URL',
      ok: false,
      severity: 'error',
      title: 'That address is not allowed.',
      detail:
        'The API URL must be a public internet host. Local, private and link-local addresses are refused.',
    });
  }

  /*
   * STAGE 1 — sign in.
   *
   * V2.6 will not answer a card question without a token, so testing the card
   * endpoint alone could only ever report "unauthorised" and leave the admin
   * guessing which of four credentials was wrong.
   */
  const creds = { apiUrl, apiKey, username, password };
  let token: string;
  try {
    clearSmartCheckTokens();
    token = await getSmartCheckToken(creds, { forceRefresh: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sign-in failed.';
    if (/no token was found/i.test(message)) {
      return done({
        outcome: 'SIGN_IN_NO_TOKEN',
        ok: false,
        severity: 'error',
        stage: 'sign-in',
        title: 'Signed in, but no token came back.',
        detail:
          'Smart Check accepted the credentials but the response did not contain a token under any name we recognise. The expected field names are listed in AUTH_SHAPE and need confirming against the partner documentation.',
      });
    }
    if (/rejected the username/i.test(message)) {
      return done({
        outcome: 'SIGN_IN_REJECTED',
        ok: false,
        severity: 'error',
        stage: 'sign-in',
        title: 'Smart Check rejected the credentials.',
        detail:
          'The username, password or API key was not accepted by /authenticate. Check all three against the partner documentation.',
      });
    }
    // Name the host. A typo in the base URL is the most likely cause, and a
    // message that omits it makes the admin go looking for a network problem.
    return done({
      outcome: 'UNREACHABLE',
      ok: false,
      severity: 'error',
      stage: 'sign-in',
      title: `Could not reach ${target.host} to sign in to Smart Check.`,
      detail:
        'Check the base URL is exactly as issued by CSCS, and that the host is reachable from the internet.',
    });
  }

  /* STAGE 2 — ask about a card, with the token from stage 1. */
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      method: REQUEST_SHAPE.method,
      headers: {
        // Built per request and never logged, exactly as the live path does.
        ...authHeaders(creds, token),
      },
      body: JSON.stringify({
        [REQUEST_SHAPE.fields.cardNumber]: PROBE_CARD_NUMBER,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return done({
      outcome: 'UNREACHABLE',
      ok: false,
      severity: 'error',
      // The host is echoed deliberately, unlike in the live provider: that
      // message can reach a worker, this one reaches only the admin who just
      // typed the value, and naming it is most of the diagnosis.
      title: timedOut
        ? `No response from ${target.host} within ${TIMEOUT_MS / 1000} seconds.`
        : `Could not reach ${target.host}.`,
      detail: timedOut
        ? 'The service accepted the connection but did not answer in time. Check the URL with CSCS, or try again.'
        : 'The address could not be resolved or refused the connection. Check the API URL for typos.',
    });
  } finally {
    clearTimeout(abort);
  }

  const bodyText = await res.text().catch(() => '');
  return done(classifySmartCheckResponse(res.status, bodyText, target.host));
}

/**
 * Turn an HTTP status and body into a verdict.
 *
 * SEPARATED FROM THE TRANSPORT so every branch can be tested without a live
 * socket — the host guard above refuses loopback, which would otherwise make a
 * local stub server untestable and leave this classification, the part most
 * likely to be wrong, covered only by inspection.
 */
export function classifySmartCheckResponse(
  status: number,
  bodyText: string,
  host: string,
): Omit<CscsConnectionTestResult, 'durationMs'> {
  if (status === 401 || status === 403) {
    return {
      outcome: 'SIGN_IN_OK_CARD_FAILED',
      stage: 'card-check' as const,
      ok: false,
      severity: 'error',
      httpStatus: status,
      // Sign-in already SUCCEEDED to get here, so the credentials are fine and
      // saying "check the key" would send the reader down the wrong path. Name
      // the things that are actually still unconfirmed.
      title: 'Signed in successfully, but the card endpoint refused the token.',
      detail:
        'The credentials are correct — authentication passed. What is still unconfirmed is how the token should be presented: whether the Authorization header wants a bare token or the "Bearer " prefix, and whether x-api-key must be sent alongside it. Both are single values in AUTH_SHAPE.',
    };
  }

  if (status === 404) {
    // Genuinely ambiguous, and reported as such. Under the expected contract
    // this is the SUCCESS case — no card matches the probe number — but an
    // unpublished contract means it may equally be the wrong path.
    return {
      outcome: 'CARD_NOT_FOUND',
      stage: 'card-check' as const,
      ok: false,
      severity: 'warning',
      httpStatus: status,
      // Reaching this point means stage 1 PASSED, and that is the most valuable
      // thing a first live attempt can establish. Lead with it: otherwise a
      // warning-coloured card reads as "nothing works" when in fact the base
      // URL and all four credentials have just been proven.
      title: `Signed in successfully. ${host} answered the card call, but inconclusively.`,
      detail: REQUEST_SHAPE.pathConfirmed
        ? 'A 404 means the test card number matched no record, which is the expected answer for an unknown card.'
        : 'Authentication worked, so the base URL and all four credentials are correct. The 404 is ambiguous only because the card-validation path is not yet confirmed: it means either that the card matched no record, or that this is not the path CSCS publish. Confirm the path, then run this again.',
    };
  }

  if (status === 429) {
    return {
      outcome: 'RATE_LIMITED',
      stage: 'card-check' as const,
      ok: false,
      severity: 'warning',
      httpStatus: status,
      title: 'The service was reached and the key accepted, but the request was rate limited.',
      detail: 'Connectivity and credentials look correct. Wait a moment and test again.',
    };
  }

  if (status >= 500) {
    return {
      outcome: 'SERVICE_ERROR',
      stage: 'card-check' as const,
      ok: false,
      severity: 'error',
      httpStatus: status,
      title: `${host} returned a server error (HTTP ${status}).`,
      detail:
        'The endpoint and credentials were accepted far enough to reach the service, which then failed. This is usually a fault at the provider — try again shortly.',
    };
  }

  if (status >= 400) {
    return {
      outcome: 'REQUEST_REJECTED',
      stage: 'card-check' as const,
      ok: false,
      severity: 'error',
      httpStatus: status,
      title: `The service was reached, but rejected the request (HTTP ${status}).`,
      detail:
        'The host and key are reachable, so this usually means the request format differs from the published partner contract. Confirm the endpoint path and request fields with CSCS.',
    };
  }

  let parsed: unknown = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      outcome: 'UNREADABLE_RESPONSE',
      stage: 'card-check' as const,
      ok: false,
      severity: 'warning',
      httpStatus: status,
      title: `${host} answered, but the response could not be read.`,
      detail:
        'The connection and credentials are working. The reply was not the JSON object the integration expects, so verification would not yet produce a usable result.',
    };
  }

  return {
    outcome: 'OK',
    stage: 'card-check' as const,
    ok: true,
    severity: 'success',
    httpStatus: status,
    title: `Connected to ${host} and the API key was accepted.`,
    // Deliberately stops short of "verified". See the header comment: a 2xx
    // proves the exchange happened, not that the fields were understood.
    detail:
      'The service accepted the request and returned a readable response. Confirm the card fields against the partner documentation before relying on verification results.',
  };
}
