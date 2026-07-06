import { AiCompleteInput, AiCompleteResult, AiError, AiProvider } from './AiProvider';
import { requireEnv } from '@/lib/config';

/**
 * Plain OpenAI provider (alternative to Azure OpenAI — kept for parity/portability
 * per the provider abstraction; NOT the pilot production provider). Uses the
 * OpenAI Chat Completions REST API via fetch; config read lazily on first send.
 *
 * Requires: OPENAI_API_KEY; optional OPENAI_MODEL (defaults to a small model),
 * OPENAI_BASE_URL.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const key = requireEnv('OPENAI_API_KEY');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/+$/,
      '',
    );

    const body: Record<string, unknown> = {
      model,
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
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new AiError('Failed to reach OpenAI.', error);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiError(`OpenAI returned HTTP ${res.status}: ${detail.slice(0, 300)}`);
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
      model: data.model ?? model,
      tokensPrompt: data.usage?.prompt_tokens,
      tokensOutput: data.usage?.completion_tokens,
    };
  }
}
