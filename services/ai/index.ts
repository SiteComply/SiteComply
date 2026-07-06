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
  const choice = process.env.AI_PROVIDER?.toLowerCase() || 'mock';
  switch (choice) {
    case 'azure-openai':
      cached = new AzureOpenAiProvider();
      break;
    case 'openai':
      cached = new OpenAiProvider();
      break;
    case 'mock':
      cached = new MockAiProvider();
      break;
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${choice}". Use "azure-openai", "openai" or "mock".`,
      );
  }
  return cached;
}
