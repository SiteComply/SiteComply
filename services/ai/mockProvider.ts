import { AiCompleteInput, AiCompleteResult, AiProvider } from './AiProvider';

/**
 * Development/test AI provider. Instead of calling a model it returns a
 * deterministic, clearly-labelled placeholder summary, so the AI foundation is
 * fully exercisable locally and in CI without an Azure OpenAI resource or any
 * token spend. Never selected in production once Azure OpenAI is configured.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async complete(_input: AiCompleteInput): Promise<AiCompleteResult> {
    const json = {
      headline: 'AI summaries are not enabled for this organisation.',
      keyPoints: [
        'No summary has been generated for this report.',
        'An administrator can turn on AI summaries in the Admin Centre, under AI provider settings.',
      ],
      risks: [],
      recommendedFocus: [],
    };
    return {
      text: JSON.stringify(json),
      json,
      model: 'mock',
      tokensPrompt: 0,
      tokensOutput: 0,
    };
  }
}
