import { CscsProvider } from './CscsProvider';
import { MockCscsProvider } from './mockProvider';
import { SmartCheckCscsProvider } from './smartCheckProvider';

export type {
  CscsProvider,
  CscsVerifyInput,
  CscsVerificationResult,
  CscsVerificationStatus,
  CscsQualification,
} from './CscsProvider';
export { CscsVerifyError } from './CscsProvider';

/**
 * Construct a CSCS Smart Check provider by id with explicit settings. Providers
 * fall back to env when a setting is absent.
 */
export function buildCscsProvider(
  providerId: string,
  settings: Record<string, string> = {},
): CscsProvider {
  switch (providerId.toLowerCase()) {
    case 'smartcheck':
      return new SmartCheckCscsProvider({
        apiUrl: settings.apiUrl,
        apiKey: settings.apiKey,
      });
    case 'mock':
      return new MockCscsProvider();
    default:
      throw new Error(
        `Unknown CSCS provider "${providerId}". Use "smartcheck" or "mock".`,
      );
  }
}

let cached: CscsProvider | undefined;

/**
 * Resolve the configured CSCS Smart Check provider from the CSCS_PROVIDER env
 * var. Defaults to the deterministic mock so the verification flow works out of
 * the box in development, and until a Smart Check partnership is provisioned.
 */
export function getCscsProvider(): CscsProvider {
  if (cached) return cached;
  const choice = process.env.CSCS_PROVIDER?.toLowerCase() || 'mock';
  cached = buildCscsProvider(choice);
  return cached;
}
