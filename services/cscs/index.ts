import { CscsProvider } from './CscsProvider';
import { MockCscsProvider } from './mockProvider';
import { getCscsRuntimeConfig } from './cscsConfigService';
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

/**
 * Resolve the provider from the RUNTIME CONFIG (DB over env over default).
 *
 * Deliberately not cached: the config is a live setting, and a cached provider
 * would mean an administrator's change took effect on the next restart rather
 * than the next check. One extra singleton read per verification is a trivial
 * cost against a network call to a partner API.
 */
export async function resolveCscsProvider(): Promise<CscsProvider> {
  const config = await getCscsRuntimeConfig();
  return buildCscsProvider(config.providerId, {
    apiUrl: config.apiUrl ?? '',
    apiKey: config.apiKey ?? '',
  });
}

let cached: CscsProvider | undefined;

/**
 * ENV-ONLY resolution, kept for callers that cannot await (and for tests).
 *
 * Prefer resolveCscsProvider(), which honours the runtime config an
 * administrator can actually change. This one cannot see the database, so it
 * silently ignores a stored provider choice.
 */
export function getCscsProvider(): CscsProvider {
  if (cached) return cached;
  const choice = process.env.CSCS_PROVIDER?.toLowerCase() || 'mock';
  cached = buildCscsProvider(choice);
  return cached;
}
