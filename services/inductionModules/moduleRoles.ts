import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/**
 * WHICH PLATFORM ROLES MAY DO WHAT TO A COMPANY INDUCTION MODULE.
 *
 * Lifted out of the service so `moduleActor.ts` can resolve a Platform viewer's
 * capability without importing the service, which imports the actor type — a
 * cycle. These are the PLATFORM realm's answers only; the Admin Centre's live in
 * `moduleActor.ts`, because the two realms share no role vocabulary.
 */

const DRAFT_ROLES: PlatformRoleValue[] = ['DIRECTOR', 'SITE_MANAGER'];

export function canDraftInductionModule(role: PlatformRoleValue): boolean {
  return DRAFT_ROLES.includes(role);
}

/**
 * Who may READ the company modules screen.
 *
 * ── WHY THIS IS NOT canManageInductionVideos ──────────────────────────────
 *
 * The modules screen now lives inside the Induction Videos area, but it must NOT
 * inherit that area's gate. `canManageInductionVideos` admits PROJECT_MANAGER
 * and PRINCIPAL_CONTRACTOR; a Principal Contractor has no route to company
 * policy administration today, and moving a page between folders is not a reason
 * to give them one.
 *
 * ── WHY IT IS NOT canDraftInductionModule EITHER ──────────────────────────
 *
 * That would be narrower than what exists. A Project Manager can already read
 * this screen through Settings, so gating on drafting would quietly REMOVE
 * access as a side effect of a navigation change. Reading is what a Project
 * Manager keeps; drafting and issuing stay where they were.
 *
 * So: three roles, listed here rather than derived, because the set is a
 * decision and not a consequence.
 */
const VIEW_ROLES: PlatformRoleValue[] = ['DIRECTOR', 'PROJECT_MANAGER', 'SITE_MANAGER'];

export function canViewInductionModules(role: PlatformRoleValue): boolean {
  return VIEW_ROLES.includes(role);
}

/** Issuing, and overriding at a site, are a Director's alone. */
export function canIssueInductionModule(role: PlatformRoleValue): boolean {
  return role === 'DIRECTOR';
}
