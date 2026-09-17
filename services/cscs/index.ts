import { CscsProvider } from './CscsProvider';
import { MockCscsProvider } from './mockProvider';
import { getCscsRuntimeConfig } from './cscsConfigService';
import { isCscsExemptMobile } from './cscsExemptAccounts';
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
      // `mockReason` is how the exemption branch below says WHY it chose the
      // mock. Absent, the mock explains itself as an unconfigured tenant, which
      // is correct for every other caller.
      return new MockCscsProvider(
        settings.mockReason === 'exempt-account'
          ? 'exempt-account'
          : 'not-configured',
      );
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
export async function resolveCscsProvider(
  /**
   * The operative's E.164 mobile, where the caller knows it.
   *
   * Only used to honour the exempt allow-list. Omitting it simply means the
   * exemption cannot apply, which is the safe default: a caller that does not
   * know who it is checking gets the live provider.
   */
  e164Mobile?: string | null,
): Promise<CscsProvider> {
  const config = await getCscsRuntimeConfig();

  /*
   * THE EXEMPT TEST ACCOUNT, resolved here and nowhere else.
   *
   * One branch, at the single point that decides what runs, so there is exactly
   * one place to read and one place to delete. Routing to the mock rather than
   * skipping verification is deliberate: the attempt still happens, still takes
   * the normal path and is still logged with provider = 'mock', so the audit
   * trail says what ran instead of falling silent.
   *
   * The mock is inert in production, so an exempt worker comes back UNVERIFIED
   * and can never be marked compliant by this branch.
   */
  if (isCscsExemptMobile(e164Mobile)) {
    // The reason travels with the choice. Smart Check is configured and working;
    // this ACCOUNT is exempt, and the operative is told exactly that rather than
    // being shown a message that reads as a broken integration.
    return buildCscsProvider('mock', { mockReason: 'exempt-account' });
  }

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
