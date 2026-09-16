import {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsVerifyError,
  CscsDetailsMissingError,
} from './CscsProvider';
import { mapSmartCheckResponse, type SmartCheckPayload } from './smartCheckMapper';
import {
  getSmartCheckToken,
  authHeaders,
  clearSmartCheckTokens,
  type SmartCheckCredentials,
} from './smartCheckAuth';

/**
 * Official CSCS Smart Check provider (SC-001).
 *
 * See https://www.cscssmartcheck.co.uk. The service verifies a card across the
 * CSCS Alliance partner schemes and returns the holder, scheme, grade, expiry
 * and qualifications.
 *
 * ── WHAT IS IMPLEMENTED, AND WHAT IS BLOCKED ──────────────────────────────
 *
 * Everything except the shape of one HTTP exchange:
 *
 *   IMPLEMENTED   request construction, credential resolution, auth header,
 *                 timeout + abort, HTTP status handling, JSON parsing, error
 *                 classification, mapping (smartCheckMapper), and the guarantee
 *                 that no credential ever reaches a message a user can see.
 *
 *   BLOCKED       the endpoint path, the exact auth scheme, the request field
 *                 names and the response field names. These are issued to
 *                 approved partners and cannot be responsibly guessed.
 *
 * The blocked items are isolated to REQUEST_SHAPE below and to the alternatives
 * list in the mapper. On onboarding, the change is to confirm those against the
 * partner documentation — not to write logic.
 *
 * ── WHY IT STILL REFUSES TO RUN ───────────────────────────────────────────
 *
 * `assertConfigured()` throws unless a URL and key are present. That is not a
 * placeholder: without a real endpoint this provider has nothing to call, and
 * quietly returning a fabricated success would be far worse than refusing. The
 * refusal is surfaced as a structured ERROR result by the verification service,
 * so a misconfiguration degrades to "could not be checked" rather than to a
 * false verification.
 */

const TIMEOUT_MS = 15_000;

/**
 * The request the partner API is expected to take.
 *
 * ISOLATED HERE ON PURPOSE. This object is the entire surface that partner
 * documentation will change; everything downstream is contract-stable.
 *
 * EXPORTED so the connection test (smartCheckConnectionTest.ts) probes the
 * SAME endpoint, auth header and field names that verifyCard() will really use.
 * A test with its own copy of this could pass while the live path fails — which
 * is the one outcome that would make the test worse than having none. Exporting
 * is the only change made to this file; no existing logic is altered.
 */
export const REQUEST_SHAPE = {
  /**
   * Appended to the configured base URL.
   *
   * CONFIRMED against V2.6 (2026-09-15): the card validation endpoint is
   * POST /card. The previous value, `/v1/card/verify`, appears nowhere in the
   * documentation — it was a guess made before the base URL was known, and
   * appended to that base it produced .../smarttech/v2/v1/card/verify, a URL
   * with two version segments. It is also why the card stage returned 403: this
   * gateway answers an unmatched route with 403 and an empty body, which is
   * indistinguishable from a refused token.
   */
  path: '/card',
  /**
   * Whether `path` above is CONFIRMED against the documentation.
   *
   * True since 2026-09-15. It matters because a 404 from the card stage means
   * "no such card" if the path is right and "no such endpoint" if it is not.
   * With this true the connection test may read a 404 as a card result.
   */
  pathConfirmed: true,
  method: 'POST' as const,
  /**
   * Request body field names.
   *
   * V2.6 identifies a card by SCHEME ID + SURNAME + REGISTRATION NUMBER, not by
   * a single card number — confirmed by the documented endpoint and by the Test
   * Cards page, whose records are given in exactly those three parts (e.g.
   * scheme C4T, surname Zhang, registration 14660726).
   *
   * That is a different question from the one this integration was built to ask.
   * The old shape sent `{cardNumber}` alone, which no amount of correcting the
   * path would have made work.
   *
   * NAMED BY THE SERVICE ITSELF. With scanType finally sent as a number the
   * request reached full validation, which answered in plain words: "Card serial
   * number and scheme identifier are required". So the wire names are
   * cardSerialNumber and schemeIdentifier - not the registrationNumber and
   * schemeId taken from the Test Cards page's column headings.
   *
   * camelCase is now evidenced rather than assumed: scanType was accepted at
   * exactly that casing.
   *
   * `surname` has never been objected to, but it has never been confirmed
   * either - the service names only what is MISSING, and it may simply not have
   * got that far. fieldsConfirmed stays false until a request passes validation
   * whole.
   */
  fields: {
    // The KEYS are ours; the VALUES are the wire names V2.6 uses. Renaming a key
    // would churn every call site for nothing, so only the values move.
    schemeId: 'schemeIdentifier',
    surname: 'surname',
    registrationNumber: 'cardSerialNumber',
    scanType: 'scanType',
  },
  /** Whether `fields` above is confirmed. Casing only; the parts themselves are. */
  fieldsConfirmed: false,
  /**
   * How the card details reached us.
   *
   * A NUMBER, not a string. V2.6 defines scanType as a Number and documents
   * 3 = Manual entry. We had been sending the string "MANUAL".
   *
   * THAT ONE FACT EXPLAINS THE 403, and it explains why the probe looked so
   * convincing while being wrong: every candidate it tried - MANUAL, Manual,
   * MANUAL_ENTRY, KEYED, MANUALENTRY and a deliberately invalid value - was a
   * STRING. They all failed identically because they shared the defect the
   * experiment was not varying. "Even nonsense behaves the same, so the value is
   * not being read" was the right reading of the wrong experiment: the TYPE was
   * wrong, so the value never got as far as being read.
   *
   * SiteComply has no scanner. Every lookup it makes is keyed entry, so 3 is the
   * only value the live path ever sends. Sending 1 or 2 would be a false claim
   * about how the card was captured.
   */
  scanType: 3,
  /** Documented: V2.6 defines scanType as a Number, 3 = Manual entry. */
  scanTypeConfirmed: true,
};

/**
 * Scan types the connection test may try, most correct first.
 *
 * NUMBERS, because V2.6 defines the field as a Number. The previous list held
 * six spellings of "manual" as strings and could never have succeeded: it varied
 * the value while holding the wrong type constant, so every entry failed the
 * same way and the report concluded the value was irrelevant. It was - but not
 * for the reason given.
 *
 * 3 is manual entry and is what the live path sends. 1 and 2 are here ONLY so a
 * failing run can say whether the endpoint accepts any scan type at all; they
 * describe scanning methods SiteComply does not have, so the live path must
 * never send them.
 */
export const CANDIDATE_SCAN_TYPES: number[] = [3, 1, 2];

/**
 * Wire-name sets the connection test may try, most likely first.
 *
 * Entry one is what REQUEST_SHAPE.fields sends, so a run that succeeds there
 * proves the live names are right. The rest exist because the Test Cards page
 * and the API use different vocabularies for the same fields - "Scheme ID" and
 * "Registration Number" against "scheme identifier" and "card serial number" -
 * and guessing between two sources has already cost a day.
 *
 * Probed by the TEST only, and only while validation is still objecting. The
 * live path sends REQUEST_SHAPE.fields until this reports and the change is made
 * deliberately.
 */
export const CANDIDATE_FIELD_NAMINGS: {
  label: string;
  schemeId: string;
  surname: string;
  registrationNumber: string;
}[] = [
  {
    label: 'schemeIdentifier / surname / cardSerialNumber',
    schemeId: 'schemeIdentifier',
    surname: 'surname',
    registrationNumber: 'cardSerialNumber',
  },
  {
    label: 'schemeIdentifier / surName / cardSerialNumber',
    schemeId: 'schemeIdentifier',
    surname: 'surName',
    registrationNumber: 'cardSerialNumber',
  },
  {
    label: 'schemeId / surname / cardSerialNumber',
    schemeId: 'schemeId',
    surname: 'surname',
    registrationNumber: 'cardSerialNumber',
  },
  {
    label: 'schemeIdentifier / surname / registrationNumber',
    schemeId: 'schemeIdentifier',
    surname: 'surname',
    registrationNumber: 'registrationNumber',
  },
];

/**
 * A scan type that cannot possibly be valid.
 *
 * A NUMBER out of range, not a nonsense string. As a string it tested nothing
 * the real candidates did not already test, because the wrong TYPE was the
 * defect every one of them shared — which is exactly how a sentinel can look
 * like it is ruling something out while ruling out nothing at all.
 *
 * Sent by the connection test to find out whether the field is validated by
 * value once the type is right. Never sent by the live path, and never adopted
 * whatever it returns.
 */
export const SCAN_TYPE_SENTINEL = 99;

export interface SmartCheckSettings {
  apiUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

/**
 * The three parts V2.6 identifies a card by.
 *
 * REFUSES rather than improvises. Sending a lookup without a surname or a
 * scheme id would come back as "not found", and "not found" reaching an
 * operative at a site gate reads as a rejected card — a competent worker turned
 * away by our own incomplete request. A refusal that names what is missing is
 * the honest failure.
 */
export function cardRequestBody(
  input: CscsVerifyInput,
  /** Override the scan type. Connection-test probe only. */
  scanType?: number,
): Record<string, string | number> {
  const registrationNumber = (input.cardNumber ?? '').trim();
  const surname = (input.surname ?? '').trim();
  const schemeId = (input.schemeId ?? '').trim();

  const missing = [
    registrationNumber ? null : 'registration number',
    surname ? null : 'surname',
    schemeId ? null : 'scheme ID',
  ].filter((m): m is string => m !== null);

  if (missing.length) {
    throw new CscsDetailsMissingError(
      `CSCS Smart Check needs the ${missing.join(', ')} to look a card up, and ${missing.length > 1 ? 'they are' : 'it is'} not held for this worker.`,
      missing,
    );
  }

  return {
    [REQUEST_SHAPE.fields.schemeId]: schemeId,
    [REQUEST_SHAPE.fields.surname]: surname,
    [REQUEST_SHAPE.fields.registrationNumber]: registrationNumber,
    // Not derived from the input: SiteComply has no scanner. Every lookup it
    // makes is keyed entry, so this is a property of the integration rather
    // than of the worker.
    [REQUEST_SHAPE.fields.scanType]: scanType ?? REQUEST_SHAPE.scanType,
  };
}

export class SmartCheckCscsProvider implements CscsProvider {
  readonly name = 'smartcheck';

  constructor(private readonly config: SmartCheckSettings = {}) {}

  private setting(key: keyof SmartCheckSettings, envVar: string): string {
    return (this.config[key] ?? process.env[envVar] ?? '').trim();
  }

  /**
   * Refuse rather than pretend. A provider with no endpoint cannot verify
   * anything, and the honest outcome is a check that did not happen.
   */
  private assertConfigured(): SmartCheckCredentials {
    const apiUrl = this.setting('apiUrl', 'CSCS_SMARTCHECK_API_URL');
    const apiKey = this.setting('apiKey', 'CSCS_SMARTCHECK_API_KEY');
    const username = this.setting('username', 'CSCS_SMARTCHECK_USERNAME');
    const password = this.setting('password', 'CSCS_SMARTCHECK_PASSWORD');
    // All four: V2.6 signs in before it validates, so three of them cannot run
    // a single check.
    if (!apiUrl || !apiKey || !username || !password) {
      throw new CscsVerifyError(
        'CSCS Smart Check is not configured. Add the partner API URL, API key, username and password in Admin → Settings → Integrations.',
      );
    }
    return { apiUrl, apiKey, username, password };
  }

  async verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult> {
    const creds = this.assertConfigured();
    const checkedAt = new Date();

    /**
     * V2.6 is sign-in-then-validate. A token can expire between being cached
     * and being used, so a 401 on the card call earns exactly ONE forced
     * re-authentication and retry. Exactly one: a refresh loop against a
     * partner API is how an account gets suspended.
     */
    let res = await this.callValidate(creds, input, false);
    if (res.status === 401 || res.status === 403) {
      clearSmartCheckTokens();
      res = await this.callValidate(creds, input, true);
    }
    return this.readValidateResponse(res, checkedAt);
  }

  /** One authenticated card-validation request. */
  private async callValidate(
    creds: SmartCheckCredentials,
    input: CscsVerifyInput,
    forceRefresh: boolean,
  ): Promise<Response> {
      // BUILT BEFORE THE TRY, deliberately.
      //
      // cardRequestBody throws when the worker's details are incomplete, and
      // inside the try that refusal was caught by the network handler below and
      // rewrapped as "Could not reach the CSCS Smart Check service" — a missing
      // surname reported as an outage. Same class of mistake as the sign-in
      // classifier's catch-all, and worth keeping the two apart rather than
      // trusting a catch to tell them apart.
      const body = JSON.stringify(cardRequestBody(input));

    const token = await getSmartCheckToken(creds, { forceRefresh });
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(
        `${creds.apiUrl.replace(/\/+$/, '')}${REQUEST_SHAPE.path}`,
        {
          method: REQUEST_SHAPE.method,
          // Built per request and never logged.
          headers: authHeaders(creds, token),
          body,
          signal: controller.signal,
        },
      );
    } catch (e) {
        // Anything that is already a considered verdict passes through. Only a
        // genuine transport failure becomes "could not reach".
        if (e instanceof CscsVerifyError) throw e;
      // Network failure or timeout. Deliberately generic: this string can reach
      // an operative's screen and must never carry the endpoint or a credential.
      throw new CscsVerifyError(
        'Could not reach the CSCS Smart Check service.',
        e,
        true,
      );
    } finally {
      clearTimeout(abort);
    }
  }

  /** Turn a validate response into a result, or throw. */
  private async readValidateResponse(
    res: Response,
    checkedAt: Date,
  ): Promise<CscsVerificationResult> {
    // A 404 from a lookup endpoint is a legitimate ANSWER — no such card — not
    // a transport failure, so it maps rather than throws.
    if (res.status === 404) {
      return mapSmartCheckResponse({ status: 'NOT_FOUND' }, this.name, checkedAt);
    }

    // After the single retry above, a 401/403 here means the credentials are
    // wrong, not that a token went stale. Say which, or the next person spends
    // an afternoon on the wrong problem.
    if (res.status === 401 || res.status === 403) {
      throw new CscsVerifyError(
        'CSCS Smart Check rejected our credentials.',
        undefined,
        false,
      );
    }

    if (!res.ok) {
      // The scheme's own text is not surfaced: unlike a send API, a
      // verification error body may echo the submitted card number.
      throw new CscsVerifyError(
        `CSCS Smart Check returned HTTP ${res.status}.`,
        undefined,
        res.status === 429 || res.status >= 500,
      );
    }

    const payload = (await res
      .json()
      .catch(() => null)) as SmartCheckPayload | null;
    if (!payload || typeof payload !== 'object') {
      throw new CscsVerifyError(
        'CSCS Smart Check returned an unreadable response.',
        undefined,
        true,
      );
    }

    return mapSmartCheckResponse(payload, this.name, checkedAt);
  }
}
