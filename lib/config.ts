/**
 * Centralised application configuration.
 *
 * Every external dependency (database, Azure AD, Azure Communication Services)
 * is read from environment variables here — never hard-coded. In production
 * these are provided by Azure App Service settings / Azure Key Vault references.
 *
 * For v1 we read lazily and avoid throwing at import time so the shell can boot
 * locally before the Azure integrations are wired up in later stages.
 */

export const appConfig = {
  /** Public application name, safe to expose to the client. */
  name: 'SiteComply',
  /** Canonical timezone for all British date/time formatting. */
  timeZone: 'Europe/London',
  /** Default locale for British English formatting. */
  locale: 'en-GB',
  /** Public base URL of the deployed app (used for SSO redirects, links). */
  baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
} as const;

/** Read a required server-side secret, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Add it to your .env (see .env.example) or Azure configuration.`,
    );
  }
  return value;
}

/** True when running in development; controls dev-only conveniences (e.g. mock SMS). */
export const isDev = process.env.NODE_ENV !== 'production';

/**
 * May this runtime hand a one-time passcode back to the caller that requested
 * it? Only ever true in development and test.
 *
 * DELIBERATELY NOT `isDev`. That is `NODE_ENV !== 'production'`, which FAILS
 * OPEN: an unset, misspelt or renamed NODE_ENV ("prod", "staging", empty)
 * reads as development and would disclose the code. For a convenience like
 * verbose logging that is the right trade; for a credential it is a live
 * authentication bypass, because anyone who knows a mobile number could read
 * its sign-in code straight out of the API response.
 *
 * So this ALLOW-LISTS the two environments where disclosure is intended and
 * refuses everything else. Getting NODE_ENV wrong now costs a developer some
 * convenience instead of costing production its worker sign-in.
 *
 * Independent of which SMS provider is selected: the mock provider is a
 * delivery mechanism, not an authorisation to leak codes. A production system
 * misconfigured onto the mock must still never disclose one.
 */
const CODE_DISCLOSURE_ENVIRONMENTS = new Set(['development', 'test']);

export function canDiscloseOtpCode(): boolean {
  const env = process.env.NODE_ENV;
  if (typeof env !== 'string') return false;
  return CODE_DISCLOSURE_ENVIRONMENTS.has(env.trim().toLowerCase());
}
