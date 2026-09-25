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

/**
 * MAY THIS ACTOR WORK ON THIS VIDEO?
 *
 * The authority question, asked of the VIDEO rather than of a site id, because the
 * answer depends on which kind of video it is:
 *
 *   a SITE induction  - authority over that project (`maySite`);
 *   a COMPANY video   - authority over company content (`canManage`), because it
 *                       belongs to no project and `maySite(null)` is meaningless.
 *
 * Every queue drain and every action handler asks this. It exists as one function
 * because `jobSiteId` became nullable in eight of them at once, and eight separate
 * `?? ''` fixes would each have silently allowed or denied the wrong thing.
 */
export function mayWorkOn(actor: VideoActor, video: { jobSiteId: string | null }): boolean {
  return video.jobSiteId === null ? actor.canManage : actor.maySite(video.jobSiteId);
}

/**
 * The Library's actor, as a video actor.
 *
 * Producing a company video starts from a Library asset, so the caller holds a
 * `ModuleActor` - the Library and Company Modules share one authority model. The two
 * map exactly: drafting company content is managing the production, and issuing it is
 * approving it.
 *
 * `maySite` answers for NO project, deliberately. A company video has none, and an
 * actor holding company authority has no implied authority over any particular site's
 * induction - that is a different question with a different answer.
 */
export function videoActorFromModuleActor(actor: {
  name: string;
  realm: 'PLATFORM' | 'ADMIN';
  canDraft: boolean;
  canIssue: boolean;
}): VideoActor {
  return {
    userId: null,
    adminId: null,
    name: actor.name,
    realm: actor.realm,
    canManage: actor.canDraft,
    canApprove: actor.canIssue,
    maySite: () => false,
  };
}
