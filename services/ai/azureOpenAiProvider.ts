import { AiCompleteInput, AiCompleteResult, AiError, AiProvider } from './AiProvider';
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

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const endpoint = requireEnv('AZURE_OPENAI_ENDPOINT').replace(/\/+$/, '');
    const key = requireEnv('AZURE_OPENAI_KEY');
    const deployment = requireEnv('AZURE_OPENAI_DEPLOYMENT');
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
    const url = `${endpoint}/openai/deployments/${encodeURIComponent(
      deployment,
    )}/chat/completions?api-version=${apiVersion}`;

    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_tokens: input.maxOutputTokens ?? 700,
      temperature: input.temperature ?? 0.2,
    };
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
      throw new AiError(`Azure OpenAI returned HTTP ${res.status}: ${detail.slice(0, 300)}`);
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
