import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/secretBox';

/**
 * SC-001 — runtime CSCS Smart Check configuration.
 *
 * Mirrors the SMS config store: a singleton row holds the active provider and
 * its credentials, the API key encrypted at rest, and the runtime getter merges
 * DB over env over default so nothing breaks before a row exists.
 *
 * NOT A PLACEHOLDER. Every value here is read by getCscsProvider() on the next
 * verification — changing the provider changes what actually runs, and clearing
 * the key makes the Smart Check provider refuse rather than silently succeed.
 */

const CONFIG_ID = 'cscs';

export const CSCS_PROVIDERS = [
  {
    id: 'mock',
    name: 'Mock (development)',
    description:
      'No card is checked against the CSCS service. A deterministic result is derived from the card number so the verification flow is exercisable without a Smart Check partnership.',
    requiresCredentials: false,
    // Nothing to connect to. Offering a test here would be a button that can
    // only ever report success about a provider that never leaves the process.
    supportsTest: false,
  },
  {
    id: 'smartcheck',
    name: 'CSCS Smart Check',
    description:
      'Verifies the card against the official CSCS Smart Check service. Requires partner API access.',
    requiresCredentials: true,
    supportsTest: true,
  },
] as const;

export type CscsProviderId = (typeof CSCS_PROVIDERS)[number]['id'];

export const isKnownCscsProvider = (id: string): id is CscsProviderId =>
  CSCS_PROVIDERS.some((p) => p.id === id);

async function readRow() {
  return prisma.cscsConfig.findUnique({ where: { id: CONFIG_ID } });
}

/** What the runtime uses: provider id + decrypted credentials. */
export interface CscsRuntimeConfig {
  providerId: string;
  verificationEnabled: boolean;
  apiUrl: string | null;
  apiKey: string | null;
  /** Where the provider choice came from, for the settings screen. */
  source: 'database' | 'environment' | 'default';
}

/**
 * Resolve the effective configuration.
 *
 * DB row → CSCS_PROVIDER env → 'mock'. The mock default is deliberate and is
 * why this is safe to deploy before a partnership exists: with no row and no
 * env var the platform behaves exactly as it does today.
 */
export async function getCscsRuntimeConfig(): Promise<CscsRuntimeConfig> {
  const row = await readRow();

  let providerId: string;
  let source: CscsRuntimeConfig['source'];
  if (row?.activeProvider) {
    providerId = row.activeProvider;
    source = 'database';
  } else if (process.env.CSCS_PROVIDER) {
    providerId = process.env.CSCS_PROVIDER.toLowerCase();
    source = 'environment';
  } else {
    providerId = 'mock';
    source = 'default';
  }

  return {
    providerId,
    verificationEnabled: row?.verificationEnabled ?? true,
    apiUrl:
      row?.smartCheckApiUrl ?? process.env.CSCS_SMARTCHECK_API_URL ?? null,
    apiKey: row?.smartCheckApiKey
      ? decryptSecret(row.smartCheckApiKey)
      : (process.env.CSCS_SMARTCHECK_API_KEY ?? null),
    source,
  };
}

/* -------------------------------------------------------------------------- */
/* Admin surface                                                              */
/* -------------------------------------------------------------------------- */

export interface CscsConfigView {
  activeProvider: string;
  verificationEnabled: boolean;
  smartCheckApiUrl: string;
  /** Whether a key is stored. The key itself NEVER leaves the server. */
  apiKeySet: boolean;
  source: CscsRuntimeConfig['source'];
  /** True when the active provider needs credentials it does not have. */
  needsCredentials: boolean;
  providers: typeof CSCS_PROVIDERS;
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export async function getCscsConfigForAdmin(): Promise<CscsConfigView> {
  const row = await readRow();
  const runtime = await getCscsRuntimeConfig();
  const descriptor = CSCS_PROVIDERS.find((p) => p.id === runtime.providerId);

  return {
    activeProvider: runtime.providerId,
    verificationEnabled: runtime.verificationEnabled,
    smartCheckApiUrl: row?.smartCheckApiUrl ?? '',
    apiKeySet: !!row?.smartCheckApiKey || !!process.env.CSCS_SMARTCHECK_API_KEY,
    source: runtime.source,
    needsCredentials:
      !!descriptor?.requiresCredentials && !(runtime.apiUrl && runtime.apiKey),
    providers: CSCS_PROVIDERS,
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Credentials for a connection test, before anything is saved.
 *
 * Mirrors resolveTestSettings() in the SMS store, and honours the SAME "blank
 * means keep the stored value" convention that saveCscsConfig() uses — so an
 * admin can paste a new URL, leave the stored key alone, and test that exact
 * combination. This is read-only: it saves nothing and changes no behaviour.
 *
 * It exists because saveCscsConfig() refuses to select Smart Check without
 * credentials. Testing has to work on UNSAVED values or the sequence an admin
 * needs — enter, prove, then enable — would be impossible.
 */
export async function resolveCscsTestCredentials(form: {
  smartCheckApiUrl?: string;
  smartCheckApiKey?: string;
}): Promise<{ apiUrl: string; apiKey: string }> {
  const runtime = await getCscsRuntimeConfig();
  const typed = (v?: string) => (v ?? '').trim();
  return {
    apiUrl: typed(form.smartCheckApiUrl) || (runtime.apiUrl ?? ''),
    apiKey: typed(form.smartCheckApiKey) || (runtime.apiKey ?? ''),
  };
}

export interface SaveCscsConfigInput {
  activeProvider?: string;
  verificationEnabled?: boolean;
  smartCheckApiUrl?: string;
  /** Blank means KEEP the stored key — the same convention as the SMS store. */
  smartCheckApiKey?: string;
}

export async function saveCscsConfig(
  input: SaveCscsConfigInput,
  admin: { adminId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const text = (v?: string) => (v ?? '').trim();

  const activeProvider = text(input.activeProvider) || 'mock';
  if (!isKnownCscsProvider(activeProvider)) {
    errors.activeProvider = 'Choose a valid provider.';
  }

  const apiUrl = text(input.smartCheckApiUrl);
  if (apiUrl && !/^https:\/\//i.test(apiUrl)) {
    // https only: this call carries a partner credential.
    errors.smartCheckApiUrl = 'The API URL must start with https://.';
  }

  const row = await readRow();
  const apiKeyRaw = text(input.smartCheckApiKey);
  const keyStored = apiKeyRaw
    ? encryptSecret(apiKeyRaw)
    : (row?.smartCheckApiKey ?? null);

  // REFUSE TO SELECT A PROVIDER THAT CANNOT RUN. Saving "smartcheck" without
  // credentials would produce a screen claiming verification is live while
  // every check fails — the placeholder-setting problem in another shape.
  if (activeProvider === 'smartcheck') {
    const effectiveUrl = apiUrl || row?.smartCheckApiUrl || process.env.CSCS_SMARTCHECK_API_URL;
    const effectiveKey = keyStored || process.env.CSCS_SMARTCHECK_API_KEY;
    if (!effectiveUrl || !effectiveKey) {
      errors.activeProvider =
        'CSCS Smart Check needs a partner API URL and key before it can be selected.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const data = {
    activeProvider,
    verificationEnabled: input.verificationEnabled !== false,
    smartCheckApiUrl: apiUrl || row?.smartCheckApiUrl || null,
    smartCheckApiKey: keyStored,
    updatedByAdminId: admin.adminId,
    updatedByName: admin.name,
  };

  await prisma.cscsConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
  return { ok: true };
}
