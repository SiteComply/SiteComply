import { REQUEST_SHAPE, CANDIDATE_SCAN_TYPES } from './smartCheckProvider';
import { AUTH_SHAPE } from './smartCheckAuth';
import {
  getSmartCheckToken,
  authHeaders,
  clearSmartCheckTokens,
  SmartCheckAuthError,
  bodySnippet,
  shapeSummary,
  envelopeMessage,
  authenticate,
  CANDIDATE_FIELD_SHAPES,
  CANDIDATE_AUTH_PRESENTATIONS,
  keptHeaders,
} from './smartCheckAuth';
import type { SmartCheckCredentials } from './smartCheckAuth';

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
 * The card the probe asks about.
 *
 * CSCS's own published test record, from the Test Cards / Data page — synthetic
 * data provided for integration testing, belonging to no worker and carried in
 * no compliance figure.
 *
 * It replaces an all-zero card number, which could only ever have proved that
 * the service answered. V2.6 identifies a card by scheme ID + surname +
 * registration number, and a made-up triple would come back "not found" whether
 * the mapping was right or wrong. A documented record that SHOULD resolve turns
 * the test from "did it answer" into "did it answer correctly", which is the
 * question worth asking before this goes anywhere near a site gate.
 */
const PROBE_CARD = {
  schemeId: 'C4T',
  surname: 'Zhang',
  registrationNumber: '14660726',
};

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
  | 'SIGN_IN_NO_TOKEN'
  /** The service answered the sign-in with a non-2xx that was not 401/403. */
  | 'SIGN_IN_HTTP_ERROR'
  /** The service answered 2xx, but the body would not parse as JSON. */
  | 'SIGN_IN_UNREADABLE';

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

  /*
   * An empty 2xx is the one failure that says "the service ran and did not
   * understand the request", so it is the one worth re-asking differently.
   * Each candidate shape is another credential submission against a partner
   * whose lockout policy we do not know, so the loop stops on ANY other
   * outcome — rejected credentials, a 404, a transport failure — because for
   * those the body field names are not the question.
   *
   * THE PROBE LIVES HERE AND NOT IN THE PROVIDER. Verification has to be
   * deterministic; a live path that quietly tried several shapes would hide a
   * contract change rather than report it. This reports, and the answer gets
   * written into AUTH_SHAPE.fields by hand.
   */
  clearSmartCheckTokens();
  const { token, acceptedShape, error, tried } = await signInWithCandidateShapes(creds);

  if (token === null) {
    return done(classifySignInFailure(error, target.host, tried));
  }

  /* A shape other than the first worked. That is the finding, not a footnote. */
  const shapeNote =
    acceptedShape && acceptedShape !== CANDIDATE_FIELD_SHAPES[0]?.label
      ? ` Sign-in succeeded with the body field names "${acceptedShape}", NOT the "${CANDIDATE_FIELD_SHAPES[0]?.label}" the integration sends today — AUTH_SHAPE.fields needs updating to match.`
      : '';

  /* STAGE 2 — ask about a card, with the token from stage 1. */
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /*
   * Try each way of presenting the token until one is not refused.
   *
   * EXHAUSTIVE HERE, unlike the sign-in probe. These requests carry no
   * credentials — only a token already obtained — and ask about a synthetic
   * all-zero card, so a refused attempt costs nothing and cannot lock anything
   * out. The sign-in probe was capped at two for exactly the opposite reason.
   *
   * 401 and 403 are the only statuses worth re-asking: they are the ones the
   * presentation could cause. Any other answer means the endpoint engaged with
   * the request and the presentation is not the question.
   */
  let res: Response;
  const presentationsTried: string[] = [];
  const scanTypesTried: string[] = [];
  let acceptedScanType: string | null = null;

  /** The probe's body, with one scan type substituted in. */
  const probeBody = (scanType: string) => ({
    [REQUEST_SHAPE.fields.schemeId]: PROBE_CARD.schemeId,
    [REQUEST_SHAPE.fields.surname]: PROBE_CARD.surname,
    [REQUEST_SHAPE.fields.registrationNumber]: PROBE_CARD.registrationNumber,
    [REQUEST_SHAPE.fields.scanType]: scanType,
  });
  try {
    let attempt: Response | null = null;
    for (const p of CANDIDATE_AUTH_PRESENTATIONS) {
      attempt = await fetch(target.toString(), {
        method: REQUEST_SHAPE.method,
        // Built per request and never logged, exactly as the live path does.
        headers: authHeaders(creds, token, p),
        body: JSON.stringify(probeBody(REQUEST_SHAPE.scanType)),
        signal: controller.signal,
      });
      presentationsTried.push(`${p.label} → ${attempt.status}`);
      if (attempt.status !== 401 && attempt.status !== 403) break;
    }

    /*
     * The service NAMES what it objects to, so keep asking until it stops
     * objecting to the same thing. One run then answers several questions
     * instead of one, which matters when each round trip costs a redeploy and
     * someone else's afternoon.
     *
     * Only the scan TYPE varies here — the value, not the field name. If every
     * candidate draws the same complaint, the field name is what is wrong, and
     * the report says so rather than leaving it to be inferred.
     */
    if (attempt && attempt.status >= 400 && attempt.status < 500) {
      const firstBody = await attempt.clone().text().catch(() => '');
      if (/scan\s*type/i.test(firstBody)) {
        scanTypesTried.push(`${REQUEST_SHAPE.scanType} → ${attempt.status} ${envelopeMessage(firstBody) ?? ''}`.trim());
        for (const candidate of CANDIDATE_SCAN_TYPES) {
          if (candidate === REQUEST_SHAPE.scanType) continue;
          const next = await fetch(target.toString(), {
            method: REQUEST_SHAPE.method,
            headers: authHeaders(creds, token),
            body: JSON.stringify(probeBody(candidate)),
            signal: controller.signal,
          });
          const text = await next.clone().text().catch(() => '');
          scanTypesTried.push(`${candidate} → ${next.status} ${envelopeMessage(text) ?? ''}`.trim());
          if (!/scan\s*type/i.test(text)) {
            // The complaint moved on. Whatever it says now is the real news.
            attempt = next;
            acceptedScanType = candidate;
            break;
          }
        }
      }
    }
    res = attempt as Response;
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
  const verdict = classifySmartCheckResponse(
    res.status,
    bodyText,
    target.host,
    {
      tried: presentationsTried,
      headers: keptHeaders(res.headers),
      scanTypes: scanTypesTried,
      acceptedScanType,
    },
  );
  return done({ ...verdict, detail: `${verdict.detail}${shapeNote}` });
}

/**
 * Sign in, trying each candidate body shape until one is accepted.
 *
 * SEPARATED FROM THE TRANSPORT for the same reason classifySmartCheckResponse
 * is: the host guard refuses loopback, so a stub server cannot reach the real
 * entry point, and this loop — when to try again and when to stop — would
 * otherwise be covered only by reading it. `authFn` is injectable purely so a
 * test can drive every path without a socket.
 *
 * THE STOPPING RULE IS THE WHOLE POINT. Only an empty or unparseable 2xx means
 * "the service ran and did not understand the request". Rejected credentials, a
 * 404 or a transport failure all say the field names are not the question, and
 * retrying those would submit the credentials again for no information — which
 * matters against a partner whose lockout policy is unknown.
 */
export async function signInWithCandidateShapes(
  creds: SmartCheckCredentials,
  authFn: (
    c: SmartCheckCredentials,
    f: { username: string; password: string },
  ) => Promise<{ token: string }> = authenticate,
): Promise<{
  token: string | null;
  acceptedShape: string | null;
  error: unknown;
  tried: string[];
}> {
  let error: unknown = null;
  const tried: string[] = [];

  for (const candidate of CANDIDATE_FIELD_SHAPES) {
    tried.push(candidate.label);
    try {
      const { token } = await authFn(creds, candidate.fields);
      return { token, acceptedShape: candidate.label, error: null, tried };
    } catch (e) {
      error = e;
      const kind = e instanceof SmartCheckAuthError ? e.failure.kind : 'unknown';
      if (kind !== 'unreadable') break;
    }
  }

  return { token: null, acceptedShape: null, error, tried };
}

/**
 * Turn a sign-in failure into a verdict — from the failure's OWN account of
 * itself, not from its prose.
 *
 * THE BUG THIS REPLACES. The previous version matched two regular expressions
 * against the message and sent everything else to UNREACHABLE, titled
 * "Could not reach {host}". So a real, fast answer from the partner —
 * HTTP 200 with a body that was not JSON — was reported as a host that could
 * not be reached, with an 80ms round trip sitting right next to it saying
 * otherwise. Two rounds of diagnosis went hunting for a network fault and
 * outbound IP allow-listing, neither of which existed.
 *
 * A catch-all is fine. A catch-all that names a specific, wrong cause is not.
 * Only `kind: 'transport'` means the host was not reached; every other kind
 * means it answered, and the verdict says which.
 *
 * WHAT IS SHOWN. Status, declared content type, body length and a short
 * redacted excerpt. That is the evidence an admin needs to tell "my URL is
 * wrong" from "my credentials are wrong" from "our request shape is wrong",
 * and none of it is a secret — bodySnippet() strips tokens, long values and
 * personal data before it gets here.
 */
export function classifySignInFailure(
  e: unknown,
  host: string,
  /** Field-name shapes attempted, when the empty-2xx probe ran. */
  tried: string[] = [],
): Omit<CscsConnectionTestResult, 'durationMs'> {
  const message = e instanceof Error ? e.message : 'Sign-in failed.';
  const failure = e instanceof SmartCheckAuthError ? e.failure : undefined;

  // An error that is not ours carries no kind. Treat it as transport — the only
  // honest reading of "something threw and we do not know what" — but say so
  // rather than asserting the host is unreachable.
  const kind = failure?.kind ?? 'unknown';

  /** "HTTP 200, 0 bytes, application/json" — the facts, in one clause. */
  const facts = failure
    ? [
        failure.status !== undefined ? `HTTP ${failure.status}` : null,
        failure.bodyBytes !== undefined ? `${failure.bodyBytes} bytes` : null,
        failure.contentType ?? null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const withBody = (lead: string) =>
    failure?.bodySnippet
      ? `${lead} The service replied: ${failure.bodySnippet}`
      : lead;

  /*
   * The AWS identifiers matter more than anything we can conclude from here:
   * they are what CSCS support can trace a single request by. x-amzn-errortype
   * additionally says whether the API gateway answered or the service behind it
   * did — "refused at the door" versus "ran and returned nothing".
   */
  const headers = failure?.responseHeaders;
  const trace = headers
    ? ` Response headers: ${Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}.`
    : '';
  /** What we sent, so it can be compared against the documentation directly. */
  const sent = failure?.fieldShape
    ? ` We sent POST ${AUTH_SHAPE.path} with headers content-type, accept, x-api-key and user-agent, and a JSON body of {${failure.fieldShape.replace(' / ', ', ')}}.`
    : '';
  const probed =
    tried.length > 1
      ? ` Body field names tried, in order: ${tried.join(', ')} — all refused the same way.`
      : '';

  if (kind === 'no-token') {
    return {
      outcome: 'SIGN_IN_NO_TOKEN',
      httpStatus: failure?.status,
      ok: false,
      severity: 'error',
      stage: 'sign-in',
      // "Signed in" was too generous. A partner that wraps its answer in
      // responseCode / errorCode reports application-level failures INSIDE an
      // HTTP 200, so a 200 with no token may mean the credentials were refused,
      // not that the field names moved. The title no longer asserts which.
      title: 'Smart Check answered, but the integration found no token.',
      // WHICH SHAPE GOT THROUGH is the finding here. The probe stops on
      // no-token, so this verdict can come from either candidate, and without
      // saying which we would have run the experiment and thrown away half the
      // result.
      detail: `${message}${
        failure?.fieldShape
          ? ` This was the response to a body of {${failure.fieldShape.replace(' / ', ', ')}}.`
          : ''
      }${probed}${trace}`,
    };
  }

  if (kind === 'rejected') {
    return {
      outcome: 'SIGN_IN_REJECTED',
      httpStatus: failure?.status,
      ok: false,
      severity: 'error',
      stage: 'sign-in',
      title: 'Smart Check rejected the credentials.',
      detail: `${withBody(
        `The username, password or API key was not accepted by /authenticate${facts ? ` (${facts})` : ''}. Check all three against the partner documentation, including for leading or trailing spaces.`,
      )}${trace}`,
    };
  }

  if (kind === 'unreadable') {
    return {
      outcome: 'SIGN_IN_UNREADABLE',
      httpStatus: failure?.status,
      ok: false,
      severity: 'error',
      stage: 'sign-in',
      // The host is NOT blamed. It answered, and quickly.
      title: `${host} answered the sign-in, but not with JSON.`,
      detail: `${withBody(
        `The connection, the address and the TLS handshake are all fine — the service replied${facts ? ` with ${facts}` : ''} and the body could not be parsed. An empty body here means /authenticate ran and did not accept the request as formed — the field names, an unexpected header, or a missing field — rather than that the username or password is wrong.`,
      )}${sent}${probed}${trace}`,
    };
  }

  if (kind === 'http') {
    return {
      outcome: 'SIGN_IN_HTTP_ERROR',
      httpStatus: failure?.status,
      ok: false,
      severity: 'error',
      stage: 'sign-in',
      title: `Smart Check refused the sign-in${failure?.status ? ` with HTTP ${failure.status}` : ''}.`,
      detail: `${withBody(
        `The host was reached and answered${facts ? ` (${facts})` : ''}. A 404 means the sign-in path is wrong for this base URL; a 5xx means the partner service is having trouble.`,
      )}${sent}${trace}`,
    };
  }

  // Genuinely no answer: DNS, TLS, a refused connection, or our own timeout.
  return {
    outcome: 'UNREACHABLE',
    ok: false,
    severity: 'error',
    stage: 'sign-in',
    title: failure?.timedOut
      ? `No response from ${host} in time.`
      : `Could not reach ${host} to sign in to Smart Check.`,
    detail: `${message} Check the base URL is exactly as issued by CSCS, and that the host is reachable from the internet.`,
  };
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
  probe: {
    tried?: string[];
    headers?: Record<string, string>;
    scanTypes?: string[];
    acceptedScanType?: string | null;
  } = {},
): Omit<CscsConnectionTestResult, 'durationMs'> {
  const trace = probe.headers
    ? ` Response headers: ${Object.entries(probe.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}.`
    : '';
  const attempts = probe.tried?.length
    ? ` Token presentations tried: ${probe.tried.join('; ')}.`
    : '';

  /*
   * The scan-type walk, verbatim. Each line is the service's own words about
   * one attempt, which is worth more than any verdict drawn from the status.
   *
   * Whether the FIELD NAME or the VALUE is wrong is the distinction to draw,
   * and it is drawable: the same complaint every time means the service never
   * saw a scan type at all.
   */
  const scans = probe.scanTypes?.length
    ? ` Scan types tried: ${probe.scanTypes.join('; ')}.` +
      (probe.acceptedScanType
        ? ` The service stopped objecting at "${probe.acceptedScanType}" — set REQUEST_SHAPE.scanType to it.`
        : ` Every candidate drew the same complaint, so "${REQUEST_SHAPE.fields.scanType}" is most likely the wrong FIELD NAME rather than the wrong value.`)
    : '';

  if (status === 401 || status === 403) {
    /*
     * DO NOT ASSERT THE CAUSE HERE.
     *
     * This gateway answers 403 with an empty body for a route that DOES NOT
     * EXIST — measured directly: a deliberately nonsense path under the same
     * base returns exactly the status, body and headers our card path does. So
     * a 403 cannot distinguish "the token is presented wrongly" from "there is
     * no endpoint at this address", and the previous version of this message
     * named the first as the remaining blocker, which sent the reader after the
     * header format while the path went unexamined.
     *
     * The path is the STRONGER suspect while pathConfirmed is false, because it
     * is the one thing already known to be wrong: appending it to the documented
     * base produces two version segments in one URL.
     */
    const allRefused = (probe.tried?.length ?? 0) >= CANDIDATE_AUTH_PRESENTATIONS.length;
    return {
      outcome: 'SIGN_IN_OK_CARD_FAILED',
      stage: 'card-check' as const,
      ok: false,
      severity: 'error',
      httpStatus: status,
      title: `Signed in successfully, but ${host} refused the card request.`,
      detail:
        `Authentication passed, so the credentials and the sign-in request are correct.` +
        (REQUEST_SHAPE.pathConfirmed
          ? ` The card path "${REQUEST_SHAPE.path}" is the documented one, so this is no longer a wrong-endpoint 403. On this gateway that leaves the API key not being authorised for this endpoint — a usage-plan or subscription setting CSCS control — or the token not being accepted for card lookups. The presentations below distinguish those: all four refused identically points at the key's authorisation, not at the header format.`
          : ` The card path is NOT confirmed: "${REQUEST_SHAPE.path}" appended to the configured base gives a URL with two version segments, and this gateway returns 403 with an empty body for a route that does not exist — the same answer a refused token gives. The documented card-validation path is the missing piece.`) +
        (allRefused
          ? ' Every way of presenting the token was refused identically, which is what an unmatched route looks like and is not what a single wrong header format looks like.'
          : '') +
        attempts +
        trace,
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
        ? `Authentication passed, so the base URL and all four credentials are correct. A 404 means no record matched — but the probe asks about a DOCUMENTED test card (scheme ${PROBE_CARD.schemeId}, ${PROBE_CARD.surname}, ${PROBE_CARD.registrationNumber}), which should resolve. That points at the request field names rather than at the card.${bodySnippet(bodyText) ? ` The service replied: ${bodySnippet(bodyText)}` : ''}${attempts}${trace}`
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
      // The card path is confirmed now, so a 4xx here points at the BODY — and
      // the field-name casing is the part still unconfirmed.
      detail:
        `The host, the credentials and the card path are all working, so this points at the request body. The three parts V2.6 identifies a card by are confirmed; their JSON field names are not — the integration sends ${Object.values(REQUEST_SHAPE.fields).join(', ')}.` +
        (envelopeMessage(bodyText)
          ? ` The service said — ${envelopeMessage(bodyText)}.`
          : bodySnippet(bodyText)
            ? ` The service replied: ${bodySnippet(bodyText)}`
            : '') +
        scans +
        attempts +
        trace,
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
      // Show the reply, for the same reason the sign-in stage now does: an
      // admin cannot act on "could not be read" but can act on "0 bytes" or on
      // an error envelope quoting a field name.
      detail: `The connection and credentials are working. The reply was not the JSON object the integration expects (${bodyText.length} bytes), so verification would not yet produce a usable result.${
        bodySnippet(bodyText) ? ` The service replied: ${bodySnippet(bodyText)}` : ''
      }`,
    };
  }

  /*
   * A readable answer is where the RESPONSE mapping gets settled.
   *
   * Still deliberately short of "verified": a 2xx proves the exchange happened,
   * not that we understood it. But printing the structure means the field names
   * can be read off one test run instead of guessed at over several — the same
   * move that settled the sign-in body, and the reason the probe now asks about
   * a documented test record rather than an all-zero number.
   */
  return {
    outcome: 'OK',
    stage: 'card-check' as const,
    ok: true,
    severity: 'success',
    httpStatus: status,
    title: `Connected to ${host}, signed in, and the card call was answered.`,
    detail:
      `The service accepted the request and returned a readable response for the documented test card (scheme ${PROBE_CARD.schemeId}, ${PROBE_CARD.surname}, ${PROBE_CARD.registrationNumber}).` +
      (REQUEST_SHAPE.fieldsConfirmed
        ? ''
        : ' The card request field NAMES are not yet confirmed, so a reply does not by itself prove the lookup was understood — check the response below actually describes that card.') +
      ` Response shape (values masked): ${shapeSummary(parsed)}` +
      scans +
      attempts +
      trace,
  };
}
