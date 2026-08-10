import {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsVerifyError,
} from './CscsProvider';
import { mapSmartCheckResponse, type SmartCheckPayload } from './smartCheckMapper';

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
  /** Appended to the configured base URL. */
  path: '/v1/card/verify',
  method: 'POST' as const,
  /** Header carrying the API key. */
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  /** Request body field names. */
  fields: { cardNumber: 'cardNumber', scheme: 'scheme' },
};

export interface SmartCheckSettings {
  apiUrl?: string;
  apiKey?: string;
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
  private assertConfigured(): { apiUrl: string; apiKey: string } {
    const apiUrl = this.setting('apiUrl', 'CSCS_SMARTCHECK_API_URL');
    const apiKey = this.setting('apiKey', 'CSCS_SMARTCHECK_API_KEY');
    if (!apiUrl || !apiKey) {
      throw new CscsVerifyError(
        'CSCS Smart Check is not configured. Add the partner API URL and key in Admin → Settings → Integrations.',
      );
    }
    return { apiUrl, apiKey };
  }

  async verifyCard(input: CscsVerifyInput): Promise<CscsVerificationResult> {
    const { apiUrl, apiKey } = this.assertConfigured();
    const checkedAt = new Date();

    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        `${apiUrl.replace(/\/+$/, '')}${REQUEST_SHAPE.path}`,
        {
          method: REQUEST_SHAPE.method,
          headers: {
            // Built per request and never logged.
            [REQUEST_SHAPE.authHeader]: `${REQUEST_SHAPE.authPrefix}${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            [REQUEST_SHAPE.fields.cardNumber]: input.cardNumber,
            ...(input.scheme
              ? { [REQUEST_SHAPE.fields.scheme]: input.scheme }
              : {}),
          }),
          signal: controller.signal,
        },
      );
    } catch (e) {
      // Network failure or timeout. Deliberately generic: this string can reach
      // a worker's screen and must never carry the endpoint or the key.
      throw new CscsVerifyError(
        'Could not reach the CSCS Smart Check service.',
        e,
      );
    } finally {
      clearTimeout(abort);
    }

    // A 404 from a lookup endpoint is a legitimate ANSWER — no such card —
    // not a transport failure, so it maps rather than throws.
    if (res.status === 404) {
      return mapSmartCheckResponse(
        { status: 'NOT_FOUND' },
        this.name,
        checkedAt,
      );
    }

    if (!res.ok) {
      // The scheme's own text is not surfaced: unlike a send API, a
      // verification error body may echo the submitted card number.
      throw new CscsVerifyError(
        `CSCS Smart Check returned HTTP ${res.status}.`,
      );
    }

    const payload = (await res
      .json()
      .catch(() => null)) as SmartCheckPayload | null;
    if (!payload || typeof payload !== 'object') {
      throw new CscsVerifyError(
        'CSCS Smart Check returned an unreadable response.',
      );
    }

    return mapSmartCheckResponse(payload, this.name, checkedAt);
  }
}
