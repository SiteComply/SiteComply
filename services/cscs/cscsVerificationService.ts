import {
  getCscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
} from './index';

/**
 * Orchestrates a CSCS Smart Check verification (SC-001).
 *
 * Runs the active provider and never throws: a provider/service failure is
 * mapped to an ERROR result so verification stays best-effort and never blocks a
 * worker's check-in. Callers decide how to surface the outcome.
 */
export async function verifyCscsCard(
  input: CscsVerifyInput,
): Promise<CscsVerificationResult> {
  const provider = getCscsProvider();
  try {
    return await provider.verifyCard(input);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[CSCS Smart Check] verification failed:', error);
    return {
      status: 'ERROR',
      verified: false,
      scheme: input.scheme ?? null,
      providerName: provider.name,
      checkedAt: new Date(),
      message:
        'The CSCS Smart Check service could not be reached. Your card details ' +
        'have been saved and can be verified later.',
    };
  }
}
