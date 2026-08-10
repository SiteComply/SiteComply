import { REQUEST_SHAPE } from './smartCheckProvider';

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
  | 'NOT_CONFIGURED';

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
}): Promise<CscsConnectionTestResult> {
  const started = Date.now();
  const done = (
    r: Omit<CscsConnectionTestResult, 'durationMs'>,
  ): CscsConnectionTestResult => ({ ...r, durationMs: Date.now() - started });

  const apiUrl = (credentials.apiUrl ?? '').trim();
  const apiKey = (credentials.apiKey ?? '').trim();

  if (!apiUrl || !apiKey) {
    return done({
      outcome: 'NOT_CONFIGURED',
      ok: false,
      severity: 'error',
      title: 'Nothing to test yet.',
      detail:
        'Enter the partner API URL and key above, then run the test. Neither value needs to be saved first.',
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

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      method: REQUEST_SHAPE.method,
      headers: {
        // Built per request and never logged, exactly as the live path does.
        [REQUEST_SHAPE.authHeader]: `${REQUEST_SHAPE.authPrefix}${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
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
      outcome: 'UNAUTHORISED',
      ok: false,
      severity: 'error',
      httpStatus: status,
      title: 'The service was reached, but rejected the API key.',
      detail:
        'The endpoint is correct and reachable. Check the key was copied in full and is active for this environment.',
    };
  }

  if (status === 404) {
    // Genuinely ambiguous, and reported as such. Under the expected contract
    // this is the SUCCESS case — no card matches the probe number — but an
    // unpublished contract means it may equally be the wrong path.
    return {
      outcome: 'CARD_NOT_FOUND',
      ok: false,
      severity: 'warning',
      httpStatus: status,
      title: `${host} answered, but the result is inconclusive.`,
      detail:
        'A 404 means either that the test card number matched no record — which would mean the integration is working — or that the request path is not the one CSCS publish. Confirm the path with the partner documentation before enabling verification.',
    };
  }

  if (status === 429) {
    return {
      outcome: 'RATE_LIMITED',
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
