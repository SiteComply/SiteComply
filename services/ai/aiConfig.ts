import { getAiRuntimeConfig } from '@/services/ai/aiConfigService';

/**
 * AI Summaries capability gate.
 *
 * Now backed by the runtime AiConfig (Admin → Settings → Integrations), which
 * falls back to env when unconfigured — so the feature ships OFF and an admin
 * can enable it + pick the allowed roles without a redeploy. Async because it
 * reads the config; callers are async server components / routes.
 *
 * This is the capability gate ONLY. Per-target authorisation (canRunReport /
 * permits + site-scoping) is layered on top and can only narrow access further.
 */
export async function canUseAiSummaries(role: string): Promise<boolean> {
  const rc = await getAiRuntimeConfig();
  return rc.enabled && rc.allowedRoles.has((role ?? '').toUpperCase());
}
