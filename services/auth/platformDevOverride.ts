import { timingSafeEqual } from 'crypto';

/**
 * ⚠ DEVELOPMENT-ONLY, ACCOUNT-SCOPED Platform login codes.
 *
 * These exist ONLY because real Platform OTP delivery (SMS/email) is not built
 * yet. They replace the former GLOBAL `DEV_CODE = '123456'` shortcut, which
 * accepted one fixed code for EVERY active Platform user — an unauthenticated
 * bypass. Nothing here is global: each mechanism accepts a code only for its own
 * explicit allow-list of emails, and only when enabled via env.
 *
 * Two independent mechanisms, each DISABLED BY DEFAULT and fail-closed:
 *
 *  1. PERSONAL override — a single named developer account.
 *       PLATFORM_DEV_LOGIN_ENABLED = "1"
 *       PLATFORM_DEV_LOGIN_EMAIL   = <one email>
 *       PLATFORM_DEV_LOGIN_CODE    = <code>
 *
 *  2. LEGACY TEST bypass — the seeded *test* accounts only.
 *       PLATFORM_TEST_LOGIN_ENABLED = "1"
 *       PLATFORM_TEST_LOGIN_EMAILS  = <comma-separated emails>
 *       PLATFORM_TEST_LOGIN_CODE    = <code>   (e.g. the legacy 123456)
 *
 * For EITHER mechanism to act, its ENABLED flag must be "1" AND its code AND its
 * allow-list must all be non-blank. Miss any ⇒ that mechanism does not exist, and
 * even its listed accounts fall through to the normal flow.
 *
 * The legacy 123456 is NOT hard-coded — it is supplied via env and confined to
 * the test allow-list. Any Platform user not on an enabled allow-list is rejected.
 *
 * To disable later: unset the relevant *_ENABLED (or blank its code) and restart.
 * No code change required.
 *
 * Codes are NEVER returned to a client and NEVER logged. Every attempt against an
 * allow-listed account is audited via auditPlatformOverride().
 */

type Mechanism = 'personal' | 'test';

interface LoginRule {
  mechanism: Mechanism;
  emails: Set<string>; // lower-cased allow-list
  code: string;
}

function splitEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The active login rules, in precedence order. Empty when nothing is enabled. */
function activeRules(): LoginRule[] {
  const rules: LoginRule[] = [];

  if (process.env.PLATFORM_DEV_LOGIN_ENABLED === '1') {
    const email = process.env.PLATFORM_DEV_LOGIN_EMAIL?.trim().toLowerCase();
    const code = process.env.PLATFORM_DEV_LOGIN_CODE?.trim();
    if (email && code) {
      rules.push({ mechanism: 'personal', emails: new Set([email]), code });
    }
  }

  if (process.env.PLATFORM_TEST_LOGIN_ENABLED === '1') {
    const emails = splitEmails(process.env.PLATFORM_TEST_LOGIN_EMAILS);
    const code = process.env.PLATFORM_TEST_LOGIN_CODE?.trim();
    if (emails.size > 0 && code) {
      rules.push({ mechanism: 'test', emails, code });
    }
  }

  return rules;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false; // timingSafeEqual needs equal length
  return timingSafeEqual(ba, bb);
}

/**
 * True when this email is on ANY currently-enabled override allow-list (personal
 * or test). The login routes use this to decide whether an account signs in via
 * its fixed override code or via the real SMS OTP flow — the two paths are
 * mutually exclusive, and an override account is never sent a real SMS.
 */
export function isPlatformOverrideAccount(identifierEmail: string): boolean {
  const email = identifierEmail.trim().toLowerCase();
  return activeRules().some((r) => r.emails.has(email));
}

export type OverrideOutcome = 'success' | 'wrong-code' | 'not-allow-listed';

export interface CodeLoginResult {
  ok: boolean;
  /** Which mechanism the account belongs to, or null if none. */
  mechanism: Mechanism | null;
  outcome: OverrideOutcome;
}

/**
 * The single decision point used by the verify route. Finds the first enabled
 * mechanism whose allow-list contains this email, then checks the code in
 * constant time. If the email is on no enabled allow-list, returns
 * not-allow-listed (the normal flow, which does not exist yet, would take over).
 */
export function verifyPlatformCodeLogin(
  identifierEmail: string,
  submittedCode: string,
): CodeLoginResult {
  const email = identifierEmail.trim().toLowerCase();
  const rule = activeRules().find((r) => r.emails.has(email));
  if (!rule) return { ok: false, mechanism: null, outcome: 'not-allow-listed' };
  if (!constantTimeEqual(submittedCode, rule.code)) {
    return { ok: false, mechanism: rule.mechanism, outcome: 'wrong-code' };
  }
  return { ok: true, mechanism: rule.mechanism, outcome: 'success' };
}

/**
 * Structured audit line for every code-login attempt against an allow-listed
 * account (success AND failure). Captured by the Azure App Service log stream /
 * Log Analytics. The code itself is deliberately absent.
 */
export function auditPlatformOverride(entry: {
  email: string;
  mechanism: Mechanism | null;
  outcome: OverrideOutcome;
  ip?: string;
}): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[DEV-AUTH-OVERRIDE] ${JSON.stringify({
      ts: new Date().toISOString(),
      email: entry.email,
      mechanism: entry.mechanism,
      outcome: entry.outcome,
      ip: entry.ip ?? null,
    })}`,
  );
}
