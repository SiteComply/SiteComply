/**
 * SC-001 — operatives exempt from LIVE CSCS Smart Check verification.
 *
 * One purpose: keep a dedicated test account usable for troubleshooting after
 * Smart Check goes live for everyone else, without that account's card details
 * being sent to CSCS on every profile save.
 *
 * ── CONFIGURATION ─────────────────────────────────────────────────────────
 *
 *     CSCS_MOCK_MOBILES_ENABLED = "1"
 *     CSCS_MOCK_MOBILES         = "+447700900150"   (comma-separated E.164)
 *
 * BOTH must be present and non-blank. Miss either and the mechanism does not
 * exist — every number, including the one named above, goes to the live
 * provider. There is no default and no global bypass.
 *
 * SEPARATE FROM WORKER_TEST_LOGIN_* on purpose. "Can sign in with a fixed code"
 * and "skips card verification" are different permissions, and sharing one
 * variable would mean removing one silently removed or retained the other.
 *
 * ── WHY THIS CANNOT BECOME A COMPLIANCE HOLE ──────────────────────────────
 *
 * An exempt worker is routed to the MOCK provider, which is inert in production:
 * it returns UNVERIFIED with "Card details recorded. Automatic CSCS checking is
 * not switched on yet", and `verified` is false. So the worst this can do is
 * leave a test account permanently unverified — never mark one compliant.
 *
 * That direction matters. A bypass that fails towards "not verified" is a
 * nuisance; one that fails towards "verified" is a competent-looking record for
 * a card nobody checked. A test holds the first property so a future change to
 * the mock cannot quietly convert this into the second.
 *
 * ── WHAT IS RECORDED ──────────────────────────────────────────────────────
 *
 * Nothing is hidden. The attempt is logged like any other, with
 * CscsVerificationLog.provider = 'mock', so the audit trail says exactly what
 * ran. An exempt worker looks unverified on every screen, because they are.
 *
 * ── TO REMOVE ─────────────────────────────────────────────────────────────
 *
 * Unset CSCS_MOCK_MOBILES_ENABLED and restart. No deploy needed. To remove
 * permanently: delete this file and the single `isCscsExemptMobile` branch in
 * resolveCscsProvider.
 */

function splitMobiles(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  );
}

/** The active allow-list, or null when the mechanism is not fully configured. */
function activeList(): Set<string> | null {
  if (process.env.CSCS_MOCK_MOBILES_ENABLED !== '1') return null;
  const mobiles = splitMobiles(process.env.CSCS_MOCK_MOBILES);
  return mobiles.size > 0 ? mobiles : null;
}

/**
 * True when this E.164 mobile is exempt from live Smart Check.
 *
 * Takes the ALREADY-NORMALISED number, exactly as isWorkerTestAccount does, so
 * the comparison cannot be fooled by formatting — 07700900150, +447700900150
 * and 447700900150 all normalise to one value upstream.
 */
export function isCscsExemptMobile(e164Mobile: string | null | undefined): boolean {
  if (!e164Mobile) return false;
  const list = activeList();
  if (!list) return false;
  return list.has(e164Mobile.trim());
}

/** Whether the mechanism is configured at all. For display, not for decisions. */
export function cscsExemptionIsActive(): boolean {
  return activeList() !== null;
}

/** The exempt numbers, for an admin screen. Empty when the mechanism is off. */
export function cscsExemptMobiles(): string[] {
  return [...(activeList() ?? [])];
}
