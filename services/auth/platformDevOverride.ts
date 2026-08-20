import { timingSafeEqual } from 'crypto';

/**
 * ⚠ DEVELOPMENT-ONLY, ACCOUNT-SCOPED Platform login override.
 *
 * This exists ONLY to give a single named Platform account a fixed sign-in code
 * while real Platform OTP delivery (SMS/email) is not yet built. It replaces the
 * former global `DEV_CODE = '123456'` shortcut, which accepted one fixed code for
 * EVERY active Platform user — an unauthenticated bypass. This override applies
 * to exactly one allow-listed email and no one else.
 *
 * DISABLED BY DEFAULT. It is inert unless ALL of the following env vars are set:
 *   PLATFORM_DEV_LOGIN_ENABLED = "1"      master switch (any other value ⇒ off)
 *   PLATFORM_DEV_LOGIN_EMAIL   = <email>  the one account it applies to
 *   PLATFORM_DEV_LOGIN_CODE    = <code>   the code that account may use
 * Missing or blank any of these ⇒ the override does not exist (fail closed), and
 * every account — including the allow-listed one — falls through to the normal
 * flow.
 *
 * To disable later: unset PLATFORM_DEV_LOGIN_ENABLED (or blank the code) and
 * restart. No code change required.
 *
 * The code is NEVER returned to a client and NEVER logged. All use is audited by
 * the verify route via auditPlatformOverride().
 */

export interface PlatformDevOverride {
  /** Lower-cased allow-listed email. */
  email: string;
  /** The override code (kept in memory only; never logged or returned). */
  code: string;
}

/** The active override, or null when the feature is disabled / misconfigured. */
export function getPlatformDevOverride(): PlatformDevOverride | null {
  if (process.env.PLATFORM_DEV_LOGIN_ENABLED !== '1') return null;
  const email = process.env.PLATFORM_DEV_LOGIN_EMAIL?.trim().toLowerCase();
  const code = process.env.PLATFORM_DEV_LOGIN_CODE?.trim();
  if (!email || !code) return null; // fail closed
  return { email, code };
}

/** True only when the override is active AND this identifier is the allow-listed one. */
export function isPlatformDevOverrideAccount(identifierEmail: string): boolean {
  const o = getPlatformDevOverride();
  return !!o && identifierEmail.trim().toLowerCase() === o.email;
}

/**
 * Constant-time verification of a submitted code for the allow-listed account.
 * Returns false unless the override is active, the identifier is the allow-listed
 * one, and the code matches exactly.
 */
export function checkPlatformDevOverrideCode(
  identifierEmail: string,
  submittedCode: string,
): boolean {
  const o = getPlatformDevOverride();
  if (!o) return false;
  if (identifierEmail.trim().toLowerCase() !== o.email) return false;
  const a = Buffer.from(submittedCode ?? '', 'utf8');
  const b = Buffer.from(o.code, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

/**
 * Structured audit line for every override-related verify attempt (success AND
 * failure). Captured by the Azure App Service log stream / Log Analytics. The
 * code itself is deliberately absent.
 */
export function auditPlatformOverride(entry: {
  email: string;
  outcome: 'success' | 'wrong-code' | 'not-allow-listed';
  ip?: string;
}): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[DEV-AUTH-OVERRIDE] ${JSON.stringify({
      ts: new Date().toISOString(),
      email: entry.email,
      outcome: entry.outcome,
      ip: entry.ip ?? null,
    })}`,
  );
}
