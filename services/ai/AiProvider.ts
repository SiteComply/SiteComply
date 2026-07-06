/**
 * AI provider abstraction (AI Summaries — Phase 1a foundation).
 *
 * The summary/assistant layers talk only to this interface, so the underlying
 * model gateway (Azure OpenAI by default; plain OpenAI as an alternative; a
 * console/deterministic mock for dev, tests and CI) is swapped via the
 * AI_PROVIDER env var with no change to the calling code — the same pattern as
 * services/sms/SmsProvider. Phase 2 (assistant) will add stream() + tool-calling
 * to this same interface.
 *
 * No user-facing surface consumes this yet.
 */

export interface AiCompleteInput {
  /** System prompt — role, guardrails, output contract. */
  system: string;
  /** User prompt — the scoped, PII-safe context to summarise. */
  user: string;
  /** Optional JSON schema for structured output (headline/keyPoints/…). */
  schema?: Record<string, unknown>;
  /** Cap on generated tokens. */
  maxOutputTokens?: number;
  /** Sampling temperature (low for factual summaries). */
  temperature?: number;
}

export interface AiCompleteResult {
  /** Raw text content returned by the model. */
  text: string;
  /** Parsed JSON, when the model returned valid JSON (structured output). */
  json?: unknown;
  /** The model/deployment that produced the result. */
  model: string;
  tokensPrompt?: number;
  tokensOutput?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(input: AiCompleteInput): Promise<AiCompleteResult>;
}

/** Thrown when a completion cannot be produced, to be handled gracefully upstream. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
