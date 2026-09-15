/**
 * SC-001 — the CSCS Smart Check card schemes an operative can choose from.
 *
 * ONE PLACE. The onboarding picker, the admin editor and the lookup all read
 * this, so a scheme exists once or not at all.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS LIST IS INCOMPLETE AND IS NOT READY FOR OPERATIVES.
 *
 * Smart Check covers a few dozen partner schemes. Exactly one id is confirmed:
 * C4T, which appears on the Test Cards / Data page. The rest have to come from
 * CSCS's own documentation, and they are NOT guessable — a scheme id is an
 * externally defined identifier, and inventing one produces a lookup that fails
 * and an operative told their valid card was not found.
 *
 * `SCHEME_LIST_COMPLETE` is false until the documented list is in. While it is
 * false the picker says so rather than presenting a one-item menu as if it were
 * the whole choice. Flip it in the same commit that adds the schemes, never
 * before — schemesAreUsable() is what the UI asks, and a test holds the flag to
 * matching the list's actual state.
 * ──────────────────────────────────────────────────────────────────────────
 */

export interface CscsScheme {
  /** The identifier Smart Check expects in the lookup. Never shown to a worker. */
  id: string;
  /** What the worker sees. The scheme's own name, spelled their way. */
  name: string;
}

/**
 * Confirmed schemes, in the order they should appear.
 *
 * Add entries here from the documentation. Keep the names exactly as CSCS spell
 * them: these are third-party scheme names, not our labels to tidy up.
 */
export const CSCS_SCHEMES: CscsScheme[] = [
  // Confirmed from the Smart Check Test Cards / Data page (2026-09-15).
  { id: 'C4T', name: 'C4T' },
];

/**
 * Whether the list above is the full documented set.
 *
 * FALSE. One id of a few dozen. A picker offering one option implies the others
 * do not exist, which would send an ECS or CPCS holder looking for a scheme that
 * is missing only because we have not typed it in yet.
 */
export const SCHEME_LIST_COMPLETE = false;

/** Whether a scheme can be asked of an operative yet. */
export function schemesAreUsable(): boolean {
  return SCHEME_LIST_COMPLETE && CSCS_SCHEMES.length > 0;
}

/** Look one up. Returns undefined for an id we do not know. */
export function schemeById(id: string | null | undefined): CscsScheme | undefined {
  if (!id) return undefined;
  return CSCS_SCHEMES.find((s) => s.id === id);
}

/** True when the id is one we recognise. Used before a lookup is attempted. */
export function isKnownScheme(id: string | null | undefined): boolean {
  return schemeById(id) !== undefined;
}
