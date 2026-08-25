import { timingSafeEqual } from 'crypto';

/**
 * ⚠ DEVELOPMENT-ONLY, ACCOUNT-SCOPED worker sign-in code.
 *
 * Lets ONE allow-listed worker mobile sign in with a fixed OTP, so the full
 * worker journey (onboarding, induction, dashboard, check-in, RAMS, permits)
 * can be exercised repeatedly without a live handset. It is the worker-side
 * counterpart of ./platformDevOverride.ts and takes the same shape: env-gated,
 * allow-listed, fail-closed, audited, removable without a code change.
 *
 *     WORKER_TEST_LOGIN_ENABLED = "1"
 *     WORKER_TEST_LOGIN_MOBILES = "+447100100100"   (comma-separated E.164)
 *     WORKER_TEST_LOGIN_CODE    = <code>
 *
 * All three must be present and non-blank. Miss any one and the mechanism does
 * not exist — the listed number falls through to the normal SMS flow. There is
 * no global bypass: a mobile that is not on an enabled allow-list is unaffected.
 *
 * PLANTED CHALLENGE, NOT A VERIFICATION BYPASS. This differs deliberately from
 * the Platform override, which short-circuits verification because no real
 * Platform OTP delivery existed when it was written. Worker OTP is real, so
 * instead of weakening the check we simply plant the fixed code into a genuine
 * OtpChallenge row and send no SMS. The verification path is UNTOUCHED, and the
 * test account therefore still goes through:
 *
 *   - challenge creation and hashing (hashCode(mobile, code))
 *   - the TTL / expiry window
 *   - the resend cooldown and the hourly per-mobile cap
 *   - the wrong-code attempt limit
 *   - single-use consumption of the challenge
 *
 * That keeps the journey representative of production and means no branch was
 * added to verification that could weaken it for any other worker.
 *
 * The code is NEVER returned to a client and NEVER logged. Every request against
 * an allow-listed mobile is audited via auditWorkerTestLogin(), under the same
 * [DEV-AUTH-OVERRIDE] tag as the Platform mechanism so one log query finds both.
 *
 * TO REMOVE: unset WORKER_TEST_LOGIN_ENABLED and restart — no deploy needed.
 * To remove permanently: delete this file and the single `isWorkerTestAccount`
 * branch in otpService.requestCode.
 */

function splitMobiles(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  );
}

/** The active rule, or null when the mechanism is not fully configured. */
function activeRule(): { mobiles: Set<string>; code: string } | null {
  if (process.env.WORKER_TEST_LOGIN_ENABLED !== '1') return null;
  const mobiles = splitMobiles(process.env.WORKER_TEST_LOGIN_MOBILES);
  const code = process.env.WORKER_TEST_LOGIN_CODE?.trim();
  if (mobiles.size === 0 || !code) return null;
  return { mobiles, code };
}

/**
 * True when this E.164 mobile is on the currently-enabled allow-list.
 *
 * Takes the ALREADY-NORMALISED number, so the comparison cannot be fooled by
 * formatting (0710…, +44710…, 44710… all normalise to one value upstream).
 */
export function isWorkerTestAccount(e164Mobile: string): boolean {
  const rule = activeRule();
  if (!rule) return false;
  return rule.mobiles.has(e164Mobile.trim());
}

/**
 * The fixed code to plant for an allow-listed mobile, or null when the
 * mechanism is off. Callers MUST have checked isWorkerTestAccount first.
 */
export function workerTestCode(): string | null {
  return activeRule()?.code ?? null;
}

/**
 * Constant-time compare, kept for callers that need to check a submitted code
 * directly. The normal verify path does not use this — it compares hashes of a
 * real challenge — but it exists so any future caller does not hand-roll `===`.
 */
export function workerTestCodeMatches(submitted: string): boolean {
  const rule = activeRule();
  if (!rule) return false;
  const a = Buffer.from(submitted ?? '', 'utf8');
  const b = Buffer.from(rule.code, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual needs equal length
  return timingSafeEqual(a, b);
}

/**
 * Structured audit line for every code request against an allow-listed mobile.
 * Captured by the App Service log stream. The code itself is deliberately absent.
 */
export function auditWorkerTestLogin(entry: {
  mobile: string;
  outcome: 'challenge-planted' | 'sms-suppressed';
}): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[DEV-AUTH-OVERRIDE] ${JSON.stringify({
      ts: new Date().toISOString(),
      mechanism: 'worker-test',
      mobile: entry.mobile,
      outcome: entry.outcome,
    })}`,
  );
}
