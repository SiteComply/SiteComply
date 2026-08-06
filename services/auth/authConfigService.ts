import { prisma } from '@/lib/prisma';

/**
 * Runtime authentication configuration store (Admin → Settings → Authentication).
 * Mirrors the SMS / AI config stores: a singleton row holds tunable settings and
 * getAuthRuntimeConfig() merges DB-over-env-over-default so nothing breaks before
 * a row exists. The OTP service and platform session creation read the runtime
 * getter, so admin changes take effect immediately with no redeploy — and future
 * ACS / platform auth features consume the SAME getter without code changes.
 *
 * No secrets live here, so (unlike SMS/AI) there is no encryption — all values
 * are safe to return to the admin client.
 */

const CONFIG_ID = 'auth';

/** Built-in defaults and the accepted range for each numeric setting. */
export const AUTH_LIMITS = {
  otpTtlSeconds: { default: 300, min: 60, max: 900, envKey: 'OTP_TTL_SECONDS' },
  otpMaxAttempts: {
    default: 5,
    min: 3,
    max: 10,
    envKey: 'OTP_MAX_VERIFY_ATTEMPTS',
  },
  // Platform session lifetime — 15 minutes to 30 days.
  sessionTtlSeconds: {
    default: 60 * 60 * 8,
    min: 900,
    max: 60 * 60 * 24 * 30,
    envKey: 'PLATFORM_TTL_SECONDS',
  },
  // Worker session lifetime — 15 minutes to 7 days. Shorter ceiling than the
  // platform: a worker session is a shared-device, on-site credential.
  workerSessionTtlSeconds: {
    default: 60 * 60 * 2,
    min: 900,
    max: 60 * 60 * 24 * 7,
    envKey: 'WORKER_TTL_SECONDS',
  },
} as const;

type NumericKey = keyof typeof AUTH_LIMITS;

function clamp(key: NumericKey, value: number): number {
  const { min, max } = AUTH_LIMITS[key];
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Effective value for a numeric setting: DB row → env var → built-in default. */
function effective(key: NumericKey, stored: number | null | undefined): number {
  const { default: def, envKey } = AUTH_LIMITS[key];
  if (stored != null) return clamp(key, stored);
  const env = process.env[envKey];
  const parsed = env ? Number.parseInt(env, 10) : NaN;
  if (!Number.isNaN(parsed)) return clamp(key, parsed);
  return def;
}

async function readRow() {
  return prisma.authConfig.findUnique({ where: { id: CONFIG_ID } });
}

export interface AuthConfigView {
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  sessionTtlSeconds: number;
  smsOtpEnabled: boolean;
  emailOtpEnabled: boolean;
  /** Built-in defaults + ranges, so the UI can show guidance and validate. */
  limits: typeof AUTH_LIMITS;
  /** True once an admin has saved a row (values are explicit, not defaults). */
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SaveAuthConfigInput {
  otpTtlSeconds?: number | string | null;
  otpMaxAttempts?: number | string | null;
  sessionTtlSeconds?: number | string | null;
  smsOtpEnabled?: boolean;
  emailOtpEnabled?: boolean;
}

/** Admin-safe view — the current effective values plus defaults/ranges. */
export async function getAuthConfigForAdmin(): Promise<AuthConfigView> {
  const row = await readRow();
  return {
    otpTtlSeconds: effective('otpTtlSeconds', row?.otpTtlSeconds),
    otpMaxAttempts: effective('otpMaxAttempts', row?.otpMaxAttempts),
    sessionTtlSeconds: effective('sessionTtlSeconds', row?.sessionTtlSeconds),
    smsOtpEnabled: row?.smsOtpEnabled ?? true,
    emailOtpEnabled: row?.emailOtpEnabled ?? false,
    limits: AUTH_LIMITS,
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** Parse+validate a numeric input against its range; returns an error message on failure. */
function parseNumeric(
  key: NumericKey,
  raw: number | string | null | undefined,
  label: string,
): { value: number } | { error: string } {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) {
    return { error: `${label} must be a number.` };
  }
  if (!Number.isInteger(n))
    return { error: `${label} must be a whole number.` };
  const { min, max } = AUTH_LIMITS[key];
  if (n < min || n > max) {
    return { error: `${label} must be between ${min} and ${max}.` };
  }
  return { value: n };
}

export async function saveAuthConfig(
  input: SaveAuthConfigInput,
  admin: { adminId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const ttl = parseNumeric(
    'otpTtlSeconds',
    input.otpTtlSeconds,
    'OTP expiry (seconds)',
  );
  const attempts = parseNumeric(
    'otpMaxAttempts',
    input.otpMaxAttempts,
    'Max OTP attempts',
  );
  const session = parseNumeric(
    'sessionTtlSeconds',
    input.sessionTtlSeconds,
    'Session timeout (seconds)',
  );
  if ('error' in ttl) errors.otpTtlSeconds = ttl.error;
  if ('error' in attempts) errors.otpMaxAttempts = attempts.error;
  if ('error' in session) errors.sessionTtlSeconds = session.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const data = {
    otpTtlSeconds: (ttl as { value: number }).value,
    otpMaxAttempts: (attempts as { value: number }).value,
    sessionTtlSeconds: (session as { value: number }).value,
    smsOtpEnabled: input.smsOtpEnabled !== false,
    emailOtpEnabled: input.emailOtpEnabled === true,
    updatedByAdminId: admin.adminId,
    updatedByName: admin.name,
  };

  await prisma.authConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
  return { ok: true };
}

export interface AuthRuntimeConfig {
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  sessionTtlSeconds: number;
  workerSessionTtlSeconds: number;
  smsOtpEnabled: boolean;
  emailOtpEnabled: boolean;
  workerSmsLoginEnabled: boolean;
  expressCheckInEnabled: boolean;
  invitedWorkersOnly: boolean;
  requireActiveSiteAssignment: boolean;
}

/**
 * The merged runtime config (DB → env → default). Read fresh each call so admin
 * changes apply immediately. This is the single source of truth every auth
 * consumer (OTP service, platform session creation, future ACS/platform auth)
 * reads — new features honour admin settings by calling this, no code changes.
 */
export async function getAuthRuntimeConfig(): Promise<AuthRuntimeConfig> {
  const row = await readRow();
  return {
    otpTtlSeconds: effective('otpTtlSeconds', row?.otpTtlSeconds),
    otpMaxAttempts: effective('otpMaxAttempts', row?.otpMaxAttempts),
    sessionTtlSeconds: effective('sessionTtlSeconds', row?.sessionTtlSeconds),
    workerSessionTtlSeconds: effective(
      'workerSessionTtlSeconds',
      row?.workerSessionTtlSeconds,
    ),
    smsOtpEnabled: row?.smsOtpEnabled ?? true,
    emailOtpEnabled: row?.emailOtpEnabled ?? false,
    // Defaults reproduce today's behaviour exactly: both channels on, neither
    // access control enforcing. Deploying before anyone saves changes nothing.
    workerSmsLoginEnabled: row?.workerSmsLoginEnabled ?? true,
    expressCheckInEnabled: row?.expressCheckInEnabled ?? true,
    invitedWorkersOnly: row?.invitedWorkersOnly ?? false,
    requireActiveSiteAssignment: row?.requireActiveSiteAssignment ?? false,
  };
}

/* -------------------------------------------------------------------------- */
/* Platform (Director) surface                                                */
/* -------------------------------------------------------------------------- */

/**
 * Settings → Authentication & Access, in the PLATFORM portal.
 *
 * The Admin Centre and platform Directors reach the same singleton, split by
 * what they own: the Admin Centre owns what protects the SYSTEM (OTP timings,
 * channel availability), a Director owns what governs THEIR ORGANISATION
 * (worker login options, session lifetimes, site-access floor). The seam is
 * enforced here by which fields each save function will write — the platform
 * save cannot touch a field it does not list, so a Director cannot change an
 * infrastructure timing by crafting a request.
 *
 * Every value below has an enforcement point in the running product. Nothing
 * here is a placeholder: Microsoft Entra ID, email OTP and single-session
 * enforcement are deliberately absent because the behaviour behind them does
 * not exist yet, and a control that silently does nothing is worse than no
 * control at all.
 */
export interface PlatformAuthSettingsView {
  /** Session security. */
  sessionTtlSeconds: number;
  workerSessionTtlSeconds: number;
  /** OTP settings (read-only here — the Admin Centre owns these). */
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpLength: number;
  /** Login methods. */
  smsOtpEnabled: boolean;
  workerSmsLoginEnabled: boolean;
  expressCheckInEnabled: boolean;
  /** Access controls. */
  invitedWorkersOnly: boolean;
  requireActiveSiteAssignment: boolean;

  limits: typeof AUTH_LIMITS;
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

/** The fields a Director may change. Anything not here is not writable. */
export interface SavePlatformAuthSettingsInput {
  sessionTtlSeconds?: number | string | null;
  workerSessionTtlSeconds?: number | string | null;
  workerSmsLoginEnabled?: boolean;
  expressCheckInEnabled?: boolean;
  invitedWorkersOnly?: boolean;
  requireActiveSiteAssignment?: boolean;
}

export async function getPlatformAuthSettings(): Promise<PlatformAuthSettingsView> {
  const row = await readRow();
  return {
    sessionTtlSeconds: effective('sessionTtlSeconds', row?.sessionTtlSeconds),
    workerSessionTtlSeconds: effective(
      'workerSessionTtlSeconds',
      row?.workerSessionTtlSeconds,
    ),
    otpTtlSeconds: effective('otpTtlSeconds', row?.otpTtlSeconds),
    otpMaxAttempts: effective('otpMaxAttempts', row?.otpMaxAttempts),
    // Read from the same env the OTP service reads, with the same bounds, so
    // the number shown is the number used. Deliberately duplicated rather than
    // imported: otpService imports THIS module, so reaching back for its helper
    // would close an import cycle. Not editable from either portal yet — the UI
    // says so rather than implying it can be changed.
    otpLength: Math.min(
      Math.max(Number.parseInt(process.env.OTP_LENGTH ?? '', 10) || 6, 4),
      8,
    ),
    smsOtpEnabled: row?.smsOtpEnabled ?? true,
    workerSmsLoginEnabled: row?.workerSmsLoginEnabled ?? true,
    expressCheckInEnabled: row?.expressCheckInEnabled ?? true,
    invitedWorkersOnly: row?.invitedWorkersOnly ?? false,
    requireActiveSiteAssignment: row?.requireActiveSiteAssignment ?? false,
    limits: AUTH_LIMITS,
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function savePlatformAuthSettings(
  input: SavePlatformAuthSettingsInput,
  user: { userId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const session = parseNumeric(
    'sessionTtlSeconds',
    input.sessionTtlSeconds,
    'Platform session timeout (seconds)',
  );
  const worker = parseNumeric(
    'workerSessionTtlSeconds',
    input.workerSessionTtlSeconds,
    'Worker session timeout (seconds)',
  );
  if ('error' in session) errors.sessionTtlSeconds = session.error;
  if ('error' in worker) errors.workerSessionTtlSeconds = worker.error;

  // "Require an ACTIVE assignment" is a stricter form of "must be invited": an
  // active assignment is an assignment. Allowing the strict one without the
  // base one would describe a rule the access check cannot express, so it is
  // refused here rather than silently reinterpreted.
  if (
    input.requireActiveSiteAssignment === true &&
    input.invitedWorkersOnly !== true
  ) {
    errors.requireActiveSiteAssignment =
      'Requiring an active site assignment also requires “Invited workers only”.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const data = {
    sessionTtlSeconds: (session as { value: number }).value,
    workerSessionTtlSeconds: (worker as { value: number }).value,
    workerSmsLoginEnabled: input.workerSmsLoginEnabled !== false,
    expressCheckInEnabled: input.expressCheckInEnabled !== false,
    invitedWorkersOnly: input.invitedWorkersOnly === true,
    requireActiveSiteAssignment: input.requireActiveSiteAssignment === true,
    updatedByUserId: user.userId,
    updatedByName: user.name,
  };

  await prisma.authConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
  return { ok: true };
}
