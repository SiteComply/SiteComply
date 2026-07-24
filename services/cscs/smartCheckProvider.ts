import {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsVerifyError,
} from './CscsProvider';

/**
 * Official CSCS Smart Check provider — STUB / production extension point.
 *
 * The CSCS Smart Check service (https://www.cscssmartcheck.co.uk) exposes a
 * partner API that verifies a card across the CSCS Alliance schemes and returns
 * the holder, scheme, card grade, expiry and qualifications. Left as a deliberate
 * extension point so the provider abstraction is proven for more than the mock.
 *
 * To enable: obtain Smart Check API access, set CSCS_SMARTCHECK_API_URL and
 * CSCS_SMARTCHECK_API_KEY, and implement verifyCard() (the commented body below
 * is the shape it would take) — mapping the response onto CscsVerificationResult.
 */
export class SmartCheckCscsProvider implements CscsProvider {
  readonly name = 'smartcheck';

  constructor(private readonly config?: { apiUrl?: string; apiKey?: string }) {}

  async verifyCard(_input: CscsVerifyInput): Promise<CscsVerificationResult> {
    // const apiUrl = this.config?.apiUrl ?? requireEnv('CSCS_SMARTCHECK_API_URL');
    // const apiKey = this.config?.apiKey ?? requireEnv('CSCS_SMARTCHECK_API_KEY');
    // const res = await fetch(apiUrl, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     Authorization: `Bearer ${apiKey}`,
    //   },
    //   body: JSON.stringify({
    //     cardNumber: _input.cardNumber,
    //     scheme: _input.scheme ?? undefined,
    //   }),
    // });
    // if (!res.ok) throw new CscsVerifyError(`Smart Check returned ${res.status}`);
    // const data = await res.json();
    // return mapSmartCheckResponse(data); // → CscsVerificationResult
    throw new CscsVerifyError(
      'CSCS Smart Check provider is not implemented. Set CSCS_PROVIDER to "mock".',
    );
  }
}
