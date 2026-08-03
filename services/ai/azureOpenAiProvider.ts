import {
  AiCompleteInput,
  AiCompleteResult,
  AiError,
  AiProvider,
} from './AiProvider';
import { requireEnv } from '@/lib/config';

/**
 * Azure OpenAI Service provider (the pilot production provider — UK South, UK
 * data residency, Microsoft DPA; see docs/AI_REPORT_SUMMARIES.md).
 *
 * Uses the Azure OpenAI Chat Completions REST API via fetch (Node 18+ global
 * fetch), so no SDK dependency is added. Configuration is read lazily on first
 * send, so the app boots fine with AI disabled / unconfigured.
 *
 * Requires:
 *   AZURE_OPENAI_ENDPOINT     e.g. https://<resource>.openai.azure.com
 *   AZURE_OPENAI_KEY          resource key
 *   AZURE_OPENAI_DEPLOYMENT   model deployment name
 *   AZURE_OPENAI_API_VERSION  (optional) defaults to a recent GA/preview version
 */
export class AzureOpenAiProvider implements AiProvider {
  readonly name = 'azure-openai';

  constructor(
    private readonly config?: {
      endpoint?: string;
      apiKey?: string;
      deployment?: string;
      apiVersion?: string;
    },
  ) {}

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const endpoint = (
      this.config?.endpoint || requireEnv('AZURE_OPENAI_ENDPOINT')
    ).replace(/\/+$/, '');
    const key = this.config?.apiKey || requireEnv('AZURE_OPENAI_KEY');
    const deployment =
      this.config?.deployment || requireEnv('AZURE_OPENAI_DEPLOYMENT');
    const apiVersion =
      this.config?.apiVersion ||
      process.env.AZURE_OPENAI_API_VERSION ||
      '2025-04-01-preview';
    const url = `${endpoint}/openai/deployments/${encodeURIComponent(
      deployment,
    )}/chat/completions?api-version=${apiVersion}`;

    // `max_completion_tokens` (not the legacy `max_tokens`) is required by the
    // GPT-5 / o-series reasoning models and accepted by the 4.x models on recent
    // API versions. Reasoning models also spend part of this budget on hidden
    // reasoning tokens before the visible answer, so the cap must leave headroom.
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_completion_tokens: input.maxOutputTokens ?? 2500,
    };
    // Reasoning models only accept the default temperature (1); sending any other
    // value is a 400. So only forward temperature when a caller explicitly sets one.
    if (typeof input.temperature === 'number')
      body.temperature = input.temperature;
    if (input.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'summary', schema: input.schema, strict: true },
      };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new AiError('Failed to reach Azure OpenAI.', error);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiError(
        `Azure OpenAI returned HTTP ${res.status}: ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    return {
      text,
      json,
      model: data.model ?? deployment,
      tokensPrompt: data.usage?.prompt_tokens,
      tokensOutput: data.usage?.completion_tokens,
    };
  }
}
