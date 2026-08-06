import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/secretBox';
import {
  SMS_PROVIDERS,
  getSmsProviderDescriptor,
  isKnownSmsProvider,
} from '@/services/sms/providerCatalog';

/**
 * Runtime SMS configuration store (Admin → Settings → Integrations).
 *
 * Persists the active provider and per-provider settings in the SmsConfig
 * singleton. Secret fields are encrypted at rest (lib/secretBox) and are NEVER
 * returned to the client — the admin view exposes only non-secret values plus a
 * boolean saying whether each secret is set. Falls back to env when unset.
 */

const CONFIG_ID = 'sms';

type Settings = Record<string, Record<string, string>>;

export interface SmsConfigView {
  activeProvider: string;
  /** Master switch for outbound sending. */
  sendingEnabled: boolean;
  /** Non-secret current values, per provider id. */
  values: Settings;
  /** Whether each secret field currently has a stored value, per provider id. */
  secretSet: Record<string, Record<string, boolean>>;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SaveSmsConfigInput {
  activeProvider?: string;
  sendingEnabled?: boolean;
  /** Per-provider field values. A blank secret field means "keep existing". */
  settings?: Settings;
}

async function readRow() {
  return prisma.smsConfig.findUnique({ where: { id: CONFIG_ID } });
}

/**
 * Which provider id the send path will actually use, and where that decision
 * came from.
 *
 * This MIRRORS resolveSmsProvider() in ./index.ts deliberately — same order,
 * same production default. Any screen that reports the active provider has to
 * agree with the code that sends the message, or it is worse than showing
 * nothing: it is a confident wrong answer about whether texts are reaching
 * people.
 */
function resolveProviderId(
  storedProvider: string | null | undefined,
): { providerId: string; source: 'database' | 'environment' | 'default' } {
  if (storedProvider) return { providerId: storedProvider, source: 'database' };
  const env = process.env.SMS_PROVIDER?.toLowerCase();
  if (env) return { providerId: env, source: 'environment' };
  return {
    providerId: process.env.NODE_ENV === 'production' ? 'acs' : 'mock',
    source: 'default',
  };
}

export interface SmsDeliveryStatus {
  providerId: string;
  /** Human name from the catalogue, or the raw id if it is not a known one. */
  providerName: string;
  /** True when nothing is actually delivered — codes never reach a handset. */
  isMock: boolean;
  /** False when the provider id is not one this build can construct. */
  isKnownProvider: boolean;
  /** The master outbound switch (Admin → Settings → Integrations). */
  sendingEnabled: boolean;
  source: 'database' | 'environment' | 'default';
}

/**
 * The effective SMS delivery state, WITHOUT touching any secret.
 *
 * Reads only the provider id and the master switch, so it is safe to surface
 * to any portal that is allowed to see the configuration — no connection
 * string is decrypted to answer "is SMS actually working".
 */
export async function getSmsDeliveryStatus(): Promise<SmsDeliveryStatus> {
  const row = await prisma.smsConfig.findUnique({
    where: { id: CONFIG_ID },
    select: { activeProvider: true, sendingEnabled: true },
  });
  const { providerId, source } = resolveProviderId(row?.activeProvider);
  const desc = getSmsProviderDescriptor(providerId);
  return {
    providerId,
    providerName: desc?.name ?? providerId,
    isMock: providerId === 'mock',
    isKnownProvider: !!desc,
    sendingEnabled: row?.sendingEnabled ?? true,
    source,
  };
}

function asSettings(json: unknown): Settings {
  return (json && typeof json === 'object' ? json : {}) as Settings;
}

/** Admin-safe view of the current config (no secret plaintext leaves the server). */
export async function getSmsConfigForAdmin(): Promise<SmsConfigView> {
  const row = await readRow();
  const settings = asSettings(row?.settings);
  const values: Settings = {};
  const secretSet: Record<string, Record<string, boolean>> = {};

  for (const p of SMS_PROVIDERS) {
    values[p.id] = {};
    secretSet[p.id] = {};
    const stored = settings[p.id] ?? {};
    for (const f of p.fields) {
      if (f.secret) secretSet[p.id][f.key] = !!stored[f.key];
      else values[p.id][f.key] = stored[f.key] ?? '';
    }
  }

  return {
    // Resolved the SAME way the send path resolves it. This previously ended
    // in a literal 'mock', which disagreed with resolveSmsProvider() whenever
    // SMS_PROVIDER was unset in production — that path defaults to 'acs'. The
    // screen would have shown "Mock" while real texts were being attempted
    // through ACS, or the reverse. An integrations screen that misreports the
    // live provider is how a mock survives unnoticed in production.
    activeProvider: resolveProviderId(row?.activeProvider).providerId,
    // Defaults ON when no row exists: the ACTIVE PROVIDER decides whether a
    // real message leaves, so an absent config must not read as "suppressed".
    sendingEnabled: row?.sendingEnabled ?? true,
    values,
    secretSet,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** Merge incoming field values into stored settings, encrypting new secrets. */
function mergeSettings(existing: Settings, incoming: Settings): Settings {
  const out: Settings = { ...existing };
  for (const p of SMS_PROVIDERS) {
    const prev = existing[p.id] ?? {};
    const next: Record<string, string> = { ...prev };
    const provided = incoming[p.id] ?? {};
    for (const f of p.fields) {
      const raw = (provided[f.key] ?? '').toString().trim();
      if (f.secret) {
        // Blank secret → keep existing ciphertext; non-blank → encrypt.
        if (raw !== '') next[f.key] = encryptSecret(raw);
      } else {
        next[f.key] = raw;
      }
    }
    out[p.id] = next;
  }
  return out;
}

/** Are all required fields of `providerId` satisfied in `settings`? */
function missingRequired(
  providerId: string,
  settings: Settings,
): Record<string, string> {
  const desc = getSmsProviderDescriptor(providerId);
  const errors: Record<string, string> = {};
  if (!desc) return errors;
  const stored = settings[providerId] ?? {};
  for (const f of desc.fields) {
    if (f.required && !(stored[f.key] && String(stored[f.key]).trim() !== ''))
      errors[f.key] = `${f.label} is required.`;
  }
  return errors;
}

export async function saveSmsConfig(
  input: SaveSmsConfigInput,
  admin: { adminId: string; name: string },
): Promise<
  { ok: true } | { ok: false; error?: string; errors?: Record<string, string> }
> {
  const activeProvider = (input.activeProvider ?? '').trim();
  if (!isKnownSmsProvider(activeProvider))
    return { ok: false, error: 'Choose a valid SMS provider.' };

  const row = await readRow();
  const merged = mergeSettings(asSettings(row?.settings), input.settings ?? {});

  // The provider that will actually be used must be fully configured.
  const errors = missingRequired(activeProvider, merged);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const sendingEnabled = input.sendingEnabled ?? row?.sendingEnabled ?? true;

  await prisma.smsConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      activeProvider,
      sendingEnabled,
      settings: merged,
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
    create: {
      id: CONFIG_ID,
      activeProvider,
      sendingEnabled,
      settings: merged,
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
  });
  return { ok: true };
}

/** Decrypt a provider's stored settings into a plain field→value map. */
export function decryptProviderSettings(
  providerId: string,
  settings: Settings,
): Record<string, string> {
  const desc = getSmsProviderDescriptor(providerId);
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

/**
 * The active provider + its decrypted settings for the send path. Returns null
 * when no config row exists (caller falls back to env, backward compatible).
 */
export async function getActiveSmsProviderConfig(): Promise<{
  providerId: string;
  settings: Record<string, string>;
} | null> {
  const row = await readRow();
  if (!row) return null;
  return {
    providerId: row.activeProvider,
    settings: decryptProviderSettings(
      row.activeProvider,
      asSettings(row.settings),
    ),
  };
}

/**
 * Resolve settings for a TEST — form values merged over the saved config, so an
 * admin can test before saving (blank secret fields fall back to the stored,
 * decrypted value). Only the given provider is resolved.
 */
export async function resolveTestSettings(
  providerId: string,
  formSettings: Record<string, string>,
): Promise<Record<string, string>> {
  const row = await readRow();
  const saved = decryptProviderSettings(providerId, asSettings(row?.settings));
  const desc = getSmsProviderDescriptor(providerId);
  const out: Record<string, string> = { ...saved };
  if (!desc) return out;
  for (const f of desc.fields) {
    const raw = (formSettings[f.key] ?? '').toString().trim();
    if (raw !== '') out[f.key] = raw; // form overrides; blank → keep saved
  }
  return out;
}
