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
  /** V2.6 signs in with username + password + apiKey before validating a card. */
  username: string | null;
  password: string | null;
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
    username:
      row?.smartCheckUsername ?? process.env.CSCS_SMARTCHECK_USERNAME ?? null,
    password: row?.smartCheckPassword
      ? decryptSecret(row.smartCheckPassword)
      : (process.env.CSCS_SMARTCHECK_PASSWORD ?? null),
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
  smartCheckUsername: string;
  /** Whether a password is stored. It NEVER leaves the server. */
  passwordSet: boolean;
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
    smartCheckUsername: row?.smartCheckUsername ?? '',
    passwordSet:
      !!row?.smartCheckPassword || !!process.env.CSCS_SMARTCHECK_PASSWORD,
    source: runtime.source,
    // V2.6 needs ALL FOUR. Checking only url+key would let Smart Check be
    // selected with no way to sign in, which fails at the first check-in
    // rather than here where it can be corrected.
    needsCredentials:
      !!descriptor?.requiresCredentials && !smartCheckCredentialsComplete(runtime),
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
  smartCheckUsername?: string;
  smartCheckPassword?: string;
}): Promise<{
  apiUrl: string;
  apiKey: string;
  username: string;
  password: string;
}> {
  const runtime = await getCscsRuntimeConfig();
  const typed = (v?: string) => (v ?? '').trim();
  return {
    apiUrl: typed(form.smartCheckApiUrl) || (runtime.apiUrl ?? ''),
    apiKey: typed(form.smartCheckApiKey) || (runtime.apiKey ?? ''),
    username: typed(form.smartCheckUsername) || (runtime.username ?? ''),
    password: typed(form.smartCheckPassword) || (runtime.password ?? ''),
  };
}

/**
 * Are all four V2.6 credentials present?
 *
 * ONE predicate, used by the admin view, the save guard and the provider, so
 * "configured" cannot mean three different things in three places.
 */
export function smartCheckCredentialsComplete(runtime: {
  apiUrl: string | null;
  apiKey: string | null;
  username: string | null;
  password: string | null;
}): boolean {
  return Boolean(
    runtime.apiUrl && runtime.apiKey && runtime.username && runtime.password,
  );
}

export interface SaveCscsConfigInput {
  activeProvider?: string;
  verificationEnabled?: boolean;
  smartCheckApiUrl?: string;
  /** Blank means KEEP the stored key — the same convention as the SMS store. */
  smartCheckApiKey?: string;
  smartCheckUsername?: string;
  /** Blank means KEEP the stored password. Same convention as the key. */
  smartCheckPassword?: string;
}

export async function saveCscsConfig(
  input: SaveCscsConfigInput,
  admin: { adminId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const text = (v?: string) => (v ?? '').trim();

  // Read first: an omitted field has to resolve against what is already
  // stored, both to validate it and to leave it alone.
  const row = await readRow();

  // ABSENT IS NOT A RESET.
  //
  // `text(input.activeProvider) || 'mock'` turned a field the request never
  // mentioned into 'mock', so a partial save silently switched verification
  // back to the mock provider; `verificationEnabled !== false` did the same in
  // the other direction, forcing an explicitly disabled switch back on.
  //
  // `activeProvider` is still resolved to an EFFECTIVE value here, because the
  // credential guard below has to run against the provider that will actually
  // be in force — including when the request never named one.
  const providerSupplied = input.activeProvider !== undefined;
  const activeProvider = providerSupplied
    ? text(input.activeProvider) || 'mock'
    : (row?.activeProvider ?? 'mock');
  if (!isKnownCscsProvider(activeProvider)) {
    errors.activeProvider = 'Choose a valid provider.';
  }

  const apiUrl = text(input.smartCheckApiUrl);
  if (apiUrl && !/^https:\/\//i.test(apiUrl)) {
    // https only: this call carries a partner credential.
    errors.smartCheckApiUrl = 'The API URL must start with https://.';
  }

  const apiKeyRaw = text(input.smartCheckApiKey);
  const keyStored = apiKeyRaw
    ? encryptSecret(apiKeyRaw)
    : (row?.smartCheckApiKey ?? null);

  const username = text(input.smartCheckUsername);
  const usernameStored =
    input.smartCheckUsername !== undefined
      ? username || row?.smartCheckUsername || null
      : (row?.smartCheckUsername ?? null);

  // Encrypted at rest like the key. A partner password in plaintext would be
  // the one credential a database dump hands over directly.
  const passwordRaw = text(input.smartCheckPassword);
  const passwordStored = passwordRaw
    ? encryptSecret(passwordRaw)
    : (row?.smartCheckPassword ?? null);

  // REFUSE TO SELECT A PROVIDER THAT CANNOT RUN. Saving "smartcheck" without
  // credentials would produce a screen claiming verification is live while
  // every check fails — the placeholder-setting problem in another shape.
  if (activeProvider === 'smartcheck') {
    const effectiveUrl = apiUrl || row?.smartCheckApiUrl || process.env.CSCS_SMARTCHECK_API_URL;
    const effectiveKey = keyStored || process.env.CSCS_SMARTCHECK_API_KEY;
    // V2.6 signs in before it validates, so a URL and key alone cannot run a
    // single check. Refusing here beats a screen that claims verification is
    // live while every check-in fails to authenticate.
    const effectiveUser = usernameStored || process.env.CSCS_SMARTCHECK_USERNAME;
    const effectivePass = passwordStored || process.env.CSCS_SMARTCHECK_PASSWORD;
    if (!effectiveUrl || !effectiveKey || !effectiveUser || !effectivePass) {
      errors.activeProvider =
        'CSCS Smart Check needs an API URL, API key, username and password before it can be selected.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const data = {
    // undefined is OMITTED from the update, so the column keeps its value and
    // takes its schema default on create.
    activeProvider: providerSupplied ? activeProvider : undefined,
    verificationEnabled: input.verificationEnabled,
    smartCheckApiUrl: apiUrl || row?.smartCheckApiUrl || null,
    smartCheckApiKey: keyStored,
    smartCheckUsername: usernameStored,
    smartCheckPassword: passwordStored,
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

/**
 * Is card verification actually going to happen?
 *
 * ONE predicate, because several surfaces make a promise about it and they must
 * not disagree. The check-in screen told every operative "We'll verify your card
 * against the CSCS Smart Check service" while the mock provider was active and
 * verifying nothing, which is the claim the CSCS cutover Phase 1 exists to
 * remove.
 *
 * True only when verification is switched on AND a real provider is selected.
 * The mock is not a real provider, whatever it returns.
 */
export async function cscsVerificationIsLive(): Promise<boolean> {
  const runtime = await getCscsRuntimeConfig();
  if (!runtime.verificationEnabled) return false;
  if (runtime.providerId === 'mock') return false;
  return Boolean(runtime.apiUrl && runtime.apiKey);
}
