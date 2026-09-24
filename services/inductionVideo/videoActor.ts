import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { AdminSession } from '@/lib/session';
import {
  canApproveInductionVideo,
  canManageInductionVideos,
} from '@/services/inductionVideo/inductionVideoPermissions';

/**
 * WHO IS ACTING ON AN INDUCTION VIDEO, and what they may do.
 *
 * ── WHY SITE AUTHORITY IS A FUNCTION, NOT A LIST ──────────────────────────
 *
 * This is where videos differ from company modules, and the difference is the
 * whole reason this type is not a copy of `ModuleActor`.
 *
 * Modules are company-scoped: one list, no site dimension. Every video operation
 * is site-scoped, and they all funnelled through
 *
 *     canManageInductionVideos(viewer.role) && viewer.siteIds.includes(siteId)
 *
 * An Admin Centre session has no assigned sites at all. Passing an empty list
 * would silently deny every operation - the most dangerous possible failure here,
 * because it looks like a permission decision rather than a missing concept. And
 * passing "all site ids" would mean loading every site on every call to answer a
 * question that has a constant answer.
 *
 * So site authority is asked, not enumerated. A Platform user is asked whether a
 * site is among their assigned ones; an admin answers yes, because the Admin
 * Centre is organisation-wide by definition - which is already how its sites list
 * and its check-ins behave.
 *
 * ── TWO CAPABILITIES, BECAUSE THE PLATFORM ALREADY HAS TWO ────────────────
 *
 * Preparing a script and approving one are separate acts with separate lists: a
 * Project Manager may prepare and edit but not approve, mirroring how they can
 * prepare an audit but not sign it off. Collapsing them into one flag for the sake
 * of the Admin Centre would quietly grant Project Managers approval, so the split
 * is preserved and each realm answers both questions.
 *
 * ── THE REALM IS FOR THE RECORD, NEVER FOR A DECISION ─────────────────────
 *
 * Identical to `ModuleActor`: `canManage` and `canApprove` decide, `realm` is
 * written to the audit trail so "approved by Jane Smith" can be told apart from
 * "approved by Jane Smith, from the Admin Centre".
 */
export interface VideoActor {
  /** Platform user id — null for an admin, who lives in a different table. */
  userId: string | null;
  /** Admin id — null for a platform user. Never written to a platform column. */
  adminId: string | null;
  name: string;
  realm: VideoActorRealm;
  /** Generate, edit scenes, narrate, render. */
  canManage: boolean;
  /** Approve, publish, withdraw — retiring a version included. */
  canApprove: boolean;
  /** Whether this actor may act on this project at all. */
  maySite: (siteId: string) => boolean;
}

export type VideoActorRealm = 'PLATFORM' | 'ADMIN';

/** The Platform: a signed-in platform user, limited to their assigned sites. */
export function videoActorFromPlatformViewer(viewer: PlatformViewer): VideoActor {
  const manage = canManageInductionVideos(viewer.role);
  return {
    userId: viewer.id,
    adminId: null,
    name: viewer.name,
    realm: 'PLATFORM',
    canManage: manage,
    canApprove: manage && canApproveInductionVideo(viewer.role),
    // Unchanged from canWorkOnVideoSite: the role must allow the work AND the
    // project must be one of theirs.
    maySite: (siteId: string) => manage && viewer.siteIds.includes(siteId),
  };
}

/**
 * The Admin Centre: OWNER and ADMIN have authority equivalent to a Platform
 * Director for induction video management, by the owner's decision — generation,
 * approval, publishing, version management and retirement, across every project.
 *
 * VIEWER stays read-only, which is the admin tier's own invariant
 * (`ADMIN_WRITE_ROLES` excludes it everywhere else) rather than a restriction
 * invented here.
 */
export function videoActorFromAdmin(admin: AdminSession): VideoActor {
  const manages = admin.role === 'OWNER' || admin.role === 'ADMIN';
  return {
    userId: null,
    adminId: admin.adminId,
    name: admin.name,
    realm: 'ADMIN',
    canManage: manages,
    canApprove: manages,
    // Organisation-wide: every project, or none at all for a VIEWER. The site is
    // not consulted because the answer does not depend on it.
    maySite: () => manages,
  };
}

/** How a realm reads on screen and in the audit trail. */
export function describeVideoRealm(realm: string | null | undefined): string | null {
  if (realm === 'ADMIN') return 'Admin Centre';
  if (realm === 'PLATFORM') return 'Platform';
  return null;
}
