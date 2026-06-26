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
