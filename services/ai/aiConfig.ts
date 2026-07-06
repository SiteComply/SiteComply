/**
 * AI Summaries configuration & feature-flag helpers (Phase 1a foundation).
 *
 * All values are read from environment variables at call time (App Service
 * settings in production — never in the repo), so the feature can be enabled,
 * scoped and capped without a deploy. The feature ships OFF: with
 * AI_SUMMARIES_ENABLED unset, `aiSummariesEnabled()` is false and nothing runs.
 *
 * This is the capability gate ONLY. Per-target authorisation (canRunReport /
 * permits + site-scoping) is layered on top in a later phase and can only narrow
 * access further — never widen it.
 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Master switch. Ships false; enabled per-environment via App Service settings. */
export function aiSummariesEnabled(): boolean {
  return process.env.AI_SUMMARIES_ENABLED === 'true';
}

/** The configured provider name (does not construct it). */
export function aiProviderName(): string {
  return process.env.AI_PROVIDER?.toLowerCase() || 'mock';
}

/**
 * Pilot role allow-list. Defaults to Director + Project Manager (the approved
 * pilot roles). Override with AI_SUMMARY_ROLES (comma-separated PlatformRole
 * values) to widen/narrow later.
 */
export function aiSummaryRoles(): Set<string> {
  const raw = process.env.AI_SUMMARY_ROLES;
  const roles = raw
    ? raw
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean)
    : ['DIRECTOR', 'PROJECT_MANAGER'];
  return new Set(roles);
}

/**
 * The capability gate: AI summaries are available to this role only when the
 * feature is enabled AND the role is in the pilot allow-list. Returns false for
 * every other role (Auditor, Site Manager, Client, etc.) during the pilot.
 */
export function canUseAiSummaries(role: string): boolean {
  return aiSummariesEnabled() && aiSummaryRoles().has((role ?? '').toUpperCase());
}

export interface AiSummaryCaps {
  /** Live generations per user per day. */
  dailyPerUser: number;
  /** Live generations across the whole org per calendar month. */
  monthlyGlobal: number;
  /** Minimum seconds between generations for a single user. */
  minIntervalSeconds: number;
  /** Hours a cached summary is reused before a fresh generation. */
  cacheTtlHours: number;
}

/** Conservative pilot caps (see docs/AI_REPORT_SUMMARIES.md §11), env-overridable. */
export function aiSummaryCaps(): AiSummaryCaps {
  return {
    dailyPerUser: intEnv('AI_SUMMARY_DAILY_PER_USER', 20, 1, 1000),
    monthlyGlobal: intEnv('AI_SUMMARY_MONTHLY_GLOBAL', 1000, 1, 1_000_000),
    minIntervalSeconds: intEnv('AI_SUMMARY_MIN_INTERVAL_SECONDS', 10, 0, 3600),
    cacheTtlHours: intEnv('AI_SUMMARY_CACHE_TTL_HOURS', 24, 0, 24 * 30),
  };
}
