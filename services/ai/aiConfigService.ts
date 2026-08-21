import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/secretBox';
import { buildAiProvider, type AiProvider } from '@/services/ai';
import {
  AI_PROVIDERS,
  getAiProviderDescriptor,
  isKnownAiProvider,
  AI_ELIGIBLE_ROLES,
} from '@/services/ai/aiProviderCatalog';

/**
 * Runtime AI Summaries configuration store (Admin → Settings → Integrations).
 * Mirrors the SMS config store: active provider + per-provider settings (secrets
 * encrypted via lib/secretBox, never returned to the client) plus feature
 * settings (enabled flag, allowed roles, usage caps). Falls back to env when no
 * row exists, so the feature stays OFF by default.
 */

const CONFIG_ID = 'ai';
const ELIGIBLE = new Set(AI_ELIGIBLE_ROLES.map((r) => r.value));
const DEFAULT_ROLES = ['DIRECTOR', 'PROJECT_MANAGER'];

type Settings = Record<string, Record<string, string>>;

export interface AiConfigView {
  enabled: boolean;
  activeProvider: string;
  values: Settings;
  secretSet: Record<string, Record<string, boolean>>;
  allowedRoles: string[];
  dailyPerUser: number | null;
  monthlyGlobal: number | null;
  /**
   * Status: whether each provider's required fields all resolve at runtime,
   * counting the environment fallback the provider itself applies.
   */
  providerConfigured: Record<string, boolean>;
  /** Where that effective configuration comes from, for display. */
  providerConfiguredSource: Record<string, AiConfigSource>;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SaveAiConfigInput {
  enabled?: boolean;
  activeProvider?: string;
  settings?: Settings;
  allowedRoles?: string[];
  dailyPerUser?: number | null;
  monthlyGlobal?: number | null;
}

async function readRow() {
  return prisma.aiConfig.findUnique({ where: { id: CONFIG_ID } });
}
const asSettings = (json: unknown): Settings =>
  (json && typeof json === 'object' ? json : {}) as Settings;
const asRoles = (json: unknown): string[] =>
  Array.isArray(json)
    ? (json.filter((r) => typeof r === 'string') as string[])
    : [];

/**
 * The environment variable each provider field falls back to, mirroring how the
 * provider resolves configuration at runtime — see AzureOpenAiProvider.complete:
 *   `this.config?.endpoint || requireEnv('AZURE_OPENAI_ENDPOINT')`
 *
 * STATUS DISPLAY ONLY. This map never supplies a value to a provider and never
 * leaves the server; it exists so the admin screen can report the EFFECTIVE
 * configuration instead of only the database row. A deployment configured purely
 * through App Service settings (as production is) previously showed
 * "Not configured" while generating real summaries.
 *
 * Keep in sync with the provider implementations in services/ai/*Provider.ts.
 */
const PROVIDER_FIELD_ENV: Record<string, Record<string, string>> = {
  'azure-openai': {
    endpoint: 'AZURE_OPENAI_ENDPOINT',
    apiKey: 'AZURE_OPENAI_KEY',
    deployment: 'AZURE_OPENAI_DEPLOYMENT',
    apiVersion: 'AZURE_OPENAI_API_VERSION',
  },
};

/** Where a provider's effective configuration comes from. */
export type AiConfigSource = 'database' | 'environment' | 'mixed' | 'none';

function envValueFor(providerId: string, fieldKey: string): string {
  const name = PROVIDER_FIELD_ENV[providerId]?.[fieldKey];
  return name ? (process.env[name] ?? '').trim() : '';
}

/**
 * Whether a provider's required fields all resolve, from the database row OR the
 * environment fallback — the same precedence the provider itself applies.
 */
function providerConfiguredStatus(
  providerId: string,
  settings: Settings,
): { configured: boolean; source: AiConfigSource } {
  const desc = getAiProviderDescriptor(providerId);
  if (!desc) return { configured: false, source: 'none' };
  const stored = settings[providerId] ?? {};

  let anyFromDb = false;
  let anyFromEnv = false;
  let allRequiredResolve = true;

  for (const f of desc.fields) {
    const fromDb = String(stored[f.key] ?? '').trim();
    const fromEnv = fromDb ? '' : envValueFor(providerId, f.key);
    if (fromDb) anyFromDb = true;
    else if (fromEnv) anyFromEnv = true;
    if (f.required && !fromDb && !fromEnv) allRequiredResolve = false;
  }

  if (!allRequiredResolve) return { configured: false, source: 'none' };
  if (anyFromDb && anyFromEnv) return { configured: true, source: 'mixed' };
  if (anyFromEnv) return { configured: true, source: 'environment' };
  return { configured: true, source: 'database' };
}

/** Admin-safe view (no secret plaintext ever leaves the server). */
export async function getAiConfigForAdmin(): Promise<AiConfigView> {
  const row = await readRow();
  const settings = asSettings(row?.settings);
  const values: Settings = {};
  const secretSet: Record<string, Record<string, boolean>> = {};
  const configured: Record<string, boolean> = {};
  const configuredSource: Record<string, AiConfigSource> = {};

  for (const p of AI_PROVIDERS) {
    values[p.id] = {};
    secretSet[p.id] = {};
    const stored = settings[p.id] ?? {};
    for (const f of p.fields) {
      if (f.secret) secretSet[p.id][f.key] = !!stored[f.key];
      else values[p.id][f.key] = stored[f.key] ?? '';
    }
    const status = providerConfiguredStatus(p.id, settings);
    configured[p.id] = status.configured;
    configuredSource[p.id] = status.source;
  }

  const roles = asRoles(row?.allowedRoles);
  return {
    enabled: row?.enabled ?? process.env.AI_SUMMARIES_ENABLED === 'true',
    activeProvider: row?.activeProvider ?? process.env.AI_PROVIDER ?? 'mock',
    values,
    secretSet,
    allowedRoles: roles.length ? roles : DEFAULT_ROLES,
    dailyPerUser: row?.dailyPerUser ?? null,
    monthlyGlobal: row?.monthlyGlobal ?? null,
    providerConfigured: configured,
    providerConfiguredSource: configuredSource,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

function mergeSettings(existing: Settings, incoming: Settings): Settings {
  const out: Settings = { ...existing };
  for (const p of AI_PROVIDERS) {
    const next: Record<string, string> = { ...(existing[p.id] ?? {}) };
    const provided = incoming[p.id] ?? {};
    for (const f of p.fields) {
      const raw = (provided[f.key] ?? '').toString().trim();
      if (f.secret) {
        if (raw !== '') next[f.key] = encryptSecret(raw);
      } else {
        next[f.key] = raw;
      }
    }
    out[p.id] = next;
  }
  return out;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function saveAiConfig(
  input: SaveAiConfigInput,
  admin: { adminId: string; name: string },
): Promise<
  { ok: true } | { ok: false; error?: string; errors?: Record<string, string> }
> {
  const activeProvider = (input.activeProvider ?? '').trim();
  if (!isKnownAiProvider(activeProvider))
    return { ok: false, error: 'Choose a valid AI provider.' };

  const row = await readRow();
  const merged = mergeSettings(asSettings(row?.settings), input.settings ?? {});
  const enabled = !!input.enabled;

  // If the feature is being enabled, the active provider must be fully configured.
  if (enabled) {
    const desc = getAiProviderDescriptor(activeProvider);
    const stored = merged[activeProvider] ?? {};
    const errors: Record<string, string> = {};
    for (const f of desc?.fields ?? []) {
      if (f.required && !(stored[f.key] && String(stored[f.key]).trim() !== ''))
        errors[f.key] = `${f.label} is required to enable AI summaries.`;
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
  }

  const allowedRoles = (input.allowedRoles ?? [])
    .map((r) => String(r).toUpperCase())
    .filter((r) => ELIGIBLE.has(r));

  await prisma.aiConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      enabled,
      activeProvider,
      settings: merged,
      allowedRoles,
      dailyPerUser: toIntOrNull(input.dailyPerUser),
      monthlyGlobal: toIntOrNull(input.monthlyGlobal),
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
    create: {
      id: CONFIG_ID,
      enabled,
      activeProvider,
      settings: merged,
      allowedRoles,
      dailyPerUser: toIntOrNull(input.dailyPerUser),
      monthlyGlobal: toIntOrNull(input.monthlyGlobal),
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
  });
  return { ok: true };
}

export function decryptProviderSettings(
  providerId: string,
  settings: Settings,
): Record<string, string> {
  const desc = getAiProviderDescriptor(providerId);
  const stored = settings[providerId] ?? {};
  const out: Record<string, string> = {};
  if (!desc) return { ...stored };
  for (const f of desc.fields) {
    const v = stored[f.key];
    if (v == null || v === '') continue;
    out[f.key] = f.secret ? decryptSecret(v) : v;
  }
  return out;
}

/** Merge form values over the saved config for a test (blank secret → saved). */
export async function resolveTestSettings(
  providerId: string,
  formSettings: Record<string, string>,
): Promise<Record<string, string>> {
  const row = await readRow();
  const saved = decryptProviderSettings(providerId, asSettings(row?.settings));
  const desc = getAiProviderDescriptor(providerId);
  const out: Record<string, string> = { ...saved };
  for (const f of desc?.fields ?? []) {
    const raw = (formSettings[f.key] ?? '').toString().trim();
    if (raw !== '') out[f.key] = raw;
  }
  return out;
}

export interface AiRuntimeConfig {
  enabled: boolean;
  activeProvider: string;
  allowedRoles: Set<string>;
  caps: {
    dailyPerUser: number;
    monthlyGlobal: number;
    minIntervalSeconds: number;
    cacheTtlHours: number;
  };
}

function intEnv(name: string, fallback: number): number {
  const n = process.env[name]
    ? Number.parseInt(process.env[name] as string, 10)
    : NaN;
  return Number.isNaN(n) ? fallback : n;
}

/** The merged runtime config (DB over env). Read fresh so admin changes apply. */
export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const row = await readRow();
  const roles = asRoles(row?.allowedRoles);
  const envRoles = process.env.AI_SUMMARY_ROLES
    ? process.env.AI_SUMMARY_ROLES.split(',')
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean)
    : DEFAULT_ROLES;
  return {
    enabled: row ? row.enabled : process.env.AI_SUMMARIES_ENABLED === 'true',
    activeProvider: row?.activeProvider ?? process.env.AI_PROVIDER ?? 'mock',
    allowedRoles: new Set(roles.length ? roles : envRoles),
    caps: {
      dailyPerUser:
        row?.dailyPerUser ?? intEnv('AI_SUMMARY_DAILY_PER_USER', 20),
      monthlyGlobal:
        row?.monthlyGlobal ?? intEnv('AI_SUMMARY_MONTHLY_GLOBAL', 1000),
      minIntervalSeconds: intEnv('AI_SUMMARY_MIN_INTERVAL_SECONDS', 10),
      cacheTtlHours: intEnv('AI_SUMMARY_CACHE_TTL_HOURS', 24),
    },
  };
}

/** Build the active AI provider from the runtime config (env fallback). */
export async function resolveAiProvider(): Promise<AiProvider> {
  const row = await readRow();
  if (row) {
    return buildAiProvider(
      row.activeProvider,
      decryptProviderSettings(row.activeProvider, asSettings(row.settings)),
    );
  }
  return buildAiProvider(process.env.AI_PROVIDER?.toLowerCase() || 'mock');
}
