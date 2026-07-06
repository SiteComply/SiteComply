import { AiProvider } from './AiProvider';
import { MockAiProvider } from './mockProvider';
import { AzureOpenAiProvider } from './azureOpenAiProvider';
import { OpenAiProvider } from './openAiProvider';

export type { AiProvider, AiCompleteInput, AiCompleteResult } from './AiProvider';
export { AiError } from './AiProvider';

let cached: AiProvider | undefined;

/**
 * Resolve the configured AI provider from AI_PROVIDER
 * ("azure-openai" | "openai" | "mock"). Defaults to the mock so the app is inert
 * and safe until Azure OpenAI is provisioned and configured (Phase 1a ships with
 * the feature OFF and no provider wired to any route).
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached;
  cached = buildAiProvider(process.env.AI_PROVIDER?.toLowerCase() || 'mock');
  return cached;
}

/**
 * Construct an AI provider by id with explicit settings (from the runtime
 * AiConfig or a test). Providers fall back to env when a setting is absent.
 */
export function buildAiProvider(
  providerId: string,
  settings: Record<string, string> = {},
): AiProvider {
  switch (providerId.toLowerCase()) {
    case 'azure-openai':
      return new AzureOpenAiProvider({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        deployment: settings.deployment,
        apiVersion: settings.apiVersion,
      });
    case 'openai':
      return new OpenAiProvider();
    case 'mock':
      return new MockAiProvider();
    default:
      throw new Error(
        `Unknown AI provider "${providerId}". Use "azure-openai", "openai" or "mock".`,
      );
  }
}
