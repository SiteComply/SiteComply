import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { AdminSession } from '@/lib/session';
import {
  canDraftInductionModule,
  canIssueInductionModule,
} from '@/services/inductionModules/moduleRoles';

/**
 * WHO IS ACTING ON A COMPANY INDUCTION MODULE, and what they may do.
 *
 * ── WHY THIS TYPE EXISTS ──────────────────────────────────────────────────
 *
 * Company modules are administered from two places: Induction Videos (a
 * Platform user, signed in by SMS, with a PlatformRole) and the Admin Centre (an
 * Entra SSO admin, with an AdminRole). Those are different identity realms with
 * different role vocabularies and no role in common — there is no DIRECTOR in
 * the admin tier and no OWNER in the platform tier.
 *
 * The naive way to support both is to pass a realm into the service and branch:
 * `if (realm === 'ADMIN' && role === 'ADMIN')` beside every rule. That spreads
 * the authority decision across the rules and means every future change to
 * module governance has to be made, and re-asserted, twice — in two vocabularies
 * that do not correspond.
 *
 * So authority is resolved HERE, at the edge, where each realm's roles are
 * actually known, and the service receives a decided capability. The service
 * reads no role string at all. One rule set, two adapters.
 *
 * ── THE REALM IS NOT A PERMISSION, IT IS A FACT FOR THE RECORD ────────────
 *
 * `realm` must never be consulted to decide whether something is allowed — that
 * is what `canDraft` and `canIssue` are for. It exists so the audit trail can say
 * whether words spoken to every operative were issued from the Platform or the
 * Admin Centre. Two kinds of authority that are equivalent in what they may do
 * are still worth telling apart afterwards.
 *
 * ── RESIDUAL RISK, RECORDED DELIBERATELY ──────────────────────────────────
 *
 * Admin Centre membership is not currently controlled: `upsertAdminFromAzure`
 * provisions any Entra account that reaches the admin login as ADMIN on first
 * sign-in, there is no allow-list, and no route changes an admin's role. Granting
 * ADMIN the authority to issue company induction content therefore widens who can
 * change what every operative hears, to whoever can sign in.
 *
 * That was accepted by the owner as a deliberate trade for delivery speed, with
 * admin membership governance deferred to a separate piece of work. The realm on
 * every audit record is the compensating control: an action taken this way is at
 * least attributable and visible, rather than indistinguishable from a Director's.
 * If that governance work happens, the change lands in `fromAdmin` below and
 * nowhere else.
 */
export interface ModuleActor {
  /** Platform user id — null for an admin, who lives in a different table. */
  userId: string | null;
  /** Admin id — null for a platform user. Never written to a platform column. */
  adminId: string | null;
  name: string;
  /** For the record, never for a decision. */
  realm: ModuleActorRealm;
  canDraft: boolean;
  canIssue: boolean;
}

export type ModuleActorRealm = 'PLATFORM' | 'ADMIN';

/** Induction Videos → Company modules. */
export function moduleActorFromPlatformViewer(viewer: PlatformViewer): ModuleActor {
  return {
    userId: viewer.id,
    adminId: null,
    name: viewer.name,
    realm: 'PLATFORM',
    canDraft: canDraftInductionModule(viewer.role),
    canIssue: canIssueInductionModule(viewer.role),
  };
}

/**
 * Admin Centre → Settings → Induction modules.
 *
 * OWNER and ADMIN both manage, by the owner's decision: an Admin Centre
 * administrator is trusted with company-level administration and has authority
 * equivalent to a Platform Director for this content.
 *
 * VIEWER stays read-only. That is not cross-realm role separation — which the
 * owner overruled — but the admin tier's own existing invariant: VIEWER is
 * excluded from `ADMIN_WRITE_ROLES` everywhere else in the product, and a screen
 * that let a VIEWER issue company safety wording would contradict the rest of
 * the Admin Centre rather than this design.
 */
export function moduleActorFromAdmin(admin: AdminSession): ModuleActor {
  const manages = admin.role === 'OWNER' || admin.role === 'ADMIN';
  return {
    userId: null,
    adminId: admin.adminId,
    name: admin.name,
    realm: 'ADMIN',
    canDraft: manages,
    canIssue: manages,
  };
}

/** How a realm reads on screen and in the audit trail. */
export function describeRealm(realm: string | null | undefined): string | null {
  if (realm === 'ADMIN') return 'Admin Centre';
  if (realm === 'PLATFORM') return 'Platform';
  return null;
}
