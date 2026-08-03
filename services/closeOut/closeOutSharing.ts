import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
// Imported from viewerBuilder/platformViewerTypes rather than platformAccess:
// that module wraps the session viewer in React's cache(), which does not exist
// outside a request, and this service is exercised by tests that run under tsx.
import { buildViewerForUser } from '@/services/platformUsers/viewerBuilder';
import type { PlatformViewer } from '@/services/platformUsers/platformViewerTypes';
import { canGenerateCloseOutPack } from '@/services/closeOut/closeOutService';

/**
 * SC-024 Phase 3 — secure sharing of a close-out pack revision.
 *
 * WHAT A SHARE LINK IS: a 256-bit random token in the URL. The database stores
 * only its SHA-256 hash, exactly as it would a password, so a database leak
 * yields no working links.
 *
 * WHY NOT A STATELESS SIGNED TOKEN: an HMAC-signed token carrying its own expiry
 * needs no storage, but it also cannot be withdrawn — it stays valid until it
 * expires no matter what. A close-out pack sent to the wrong email address is
 * precisely the case where you must be able to kill the link now. Revocation is
 * worth the row.
 *
 * WHAT THE VISITOR SEES: the pack rendered under the SHARER'S CURRENT
 * permissions, re-resolved on every view. Permissions are not snapshotted. If
 * the sharer is deactivated or loses access to the site, the link stops working
 * — the external link can never outlive the access that created it.
 */

/** Offered expiry windows. A link with no expiry is not offered at all. */
export const SHARE_EXPIRY_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export const DEFAULT_SHARE_DAYS = 30;
export const MAX_SHARE_DAYS = 90;

export type ShareFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'sharer_lost_access';

export interface CreatedShare {
  id: string;
  /** The full URL token — returned ONCE, at creation, and never retrievable again. */
  token: string;
  expiresAt: Date;
}

export interface ShareSummary {
  id: string;
  label: string;
  includeZip: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  createdByName: string;
  createdAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  /** Derived, not stored — see the SC-016/SC-020 state-vs-occurrence rule. */
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Salted so the log cannot be scanned back to a list of visitor addresses. */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256')
    .update(`sitecomply-share\n${ip}`)
    .digest('hex')
    .slice(0, 32);
}

function shareStatus(row: {
  revokedAt: Date | null;
  expiresAt: Date;
}): ShareSummary['status'] {
  if (row.revokedAt) return 'REVOKED';
  if (row.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

/**
 * Create a share link for a pack revision.
 *
 * Requires the same right as generating the pack, plus site scope. The token is
 * returned here and nowhere else — the caller must show it immediately.
 */
export async function createShare(
  viewer: PlatformViewer,
  packId: string,
  input: { label?: string; days?: number; includeZip?: boolean },
): Promise<
  { ok: true; share: CreatedShare } | { ok: false; reason: ShareFailure }
> {
  if (!canGenerateCloseOutPack(viewer.role))
    return { ok: false, reason: 'forbidden' };

  const pack = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: { jobSiteId: true, zipBlobPath: true },
  });
  if (!pack) return { ok: false, reason: 'not_found' };
  if (!viewer.siteIds.includes(pack.jobSiteId))
    return { ok: false, reason: 'not_found' };

  const label = (input.label ?? '').trim();
  if (label === '' || label.length > 120)
    return { ok: false, reason: 'invalid' };

  const days = Number.isFinite(input.days)
    ? Number(input.days)
    : DEFAULT_SHARE_DAYS;
  if (days < 1 || days > MAX_SHARE_DAYS)
    return { ok: false, reason: 'invalid' };

  // Offering a ZIP that does not exist would produce a link with a dead button.
  const includeZip = !!input.includeZip && !!pack.zipBlobPath;

  // 32 bytes = 256 bits. base64url so it is safe in a URL and easy to paste.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);

  const created = await prisma.closeOutPackShare.create({
    data: {
      packId,
      tokenHash: hashToken(token),
      label,
      includeZip,
      expiresAt,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
    },
    select: { id: true },
  });

  return { ok: true, share: { id: created.id, token, expiresAt } };
}

/** Links for a pack, newest first. Never returns a token or its hash. */
export async function listShares(
  viewer: PlatformViewer,
  packId: string,
): Promise<ShareSummary[] | null> {
  if (!canGenerateCloseOutPack(viewer.role)) return null;
  const pack = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: { jobSiteId: true },
  });
  if (!pack || !viewer.siteIds.includes(pack.jobSiteId)) return null;

  const rows = await prisma.closeOutPackShare.findMany({
    where: { packId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      includeZip: true,
      expiresAt: true,
      revokedAt: true,
      createdByName: true,
      createdAt: true,
      viewCount: true,
      lastViewedAt: true,
    },
  });
  return rows.map((r) => ({ ...r, status: shareStatus(r) }));
}

/** Revoke a link. Idempotent: revoking an already-revoked link is a no-op. */
export async function revokeShare(
  viewer: PlatformViewer,
  shareId: string,
): Promise<boolean> {
  if (!canGenerateCloseOutPack(viewer.role)) return false;
  const share = await prisma.closeOutPackShare.findUnique({
    where: { id: shareId },
    select: { revokedAt: true, pack: { select: { jobSiteId: true } } },
  });
  if (!share) return false;
  if (!viewer.siteIds.includes(share.pack.jobSiteId)) return false;
  if (share.revokedAt) return true;

  await prisma.closeOutPackShare.update({
    where: { id: shareId },
    data: { revokedAt: new Date() },
  });
  return true;
}

export interface ResolvedShare {
  shareId: string;
  packId: string;
  label: string;
  includeZip: boolean;
  expiresAt: Date;
  sharedByName: string;
  /** The sharer's CURRENT effective access — the pack renders under this. */
  viewer: PlatformViewer;
}

/**
 * Resolve a URL token to a live share, or a reason it cannot be used.
 *
 * The order matters: revoked before expired, so someone who was cut off is told
 * the link was withdrawn rather than that it simply aged out.
 */
export async function resolveShare(
  rawToken: string,
): Promise<
  { ok: true; share: ResolvedShare } | { ok: false; reason: ShareFailure }
> {
  const token = (rawToken ?? '').trim();
  // 32 random bytes is 43 base64url characters; anything else is not a token we
  // ever issued, so it is rejected without touching the database.
  if (
    token.length < 20 ||
    token.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    return { ok: false, reason: 'invalid' };

  const row = await prisma.closeOutPackShare.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      packId: true,
      tokenHash: true,
      label: true,
      includeZip: true,
      expiresAt: true,
      revokedAt: true,
      createdByUserId: true,
      createdByName: true,
      pack: { select: { jobSiteId: true } },
    },
  });
  if (!row) return { ok: false, reason: 'invalid' };

  // The lookup already matched on a hash, but comparing constant-time keeps the
  // habit consistent with the rest of the codebase's secret handling.
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hashToken(token));
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: 'invalid' };

  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.expiresAt.getTime() <= Date.now())
    return { ok: false, reason: 'expired' };

  // The pack renders under the sharer's LIVE permissions. No creator, no link.
  if (!row.createdByUserId) return { ok: false, reason: 'sharer_lost_access' };
  const viewer = await buildViewerForUser(row.createdByUserId);
  if (!viewer) return { ok: false, reason: 'sharer_lost_access' };
  // ...and they must still be able to see this project and generate packs for
  // it, or the link is showing content its owner no longer has rights to.
  if (!viewer.siteIds.includes(row.pack.jobSiteId))
    return { ok: false, reason: 'sharer_lost_access' };
  if (!canGenerateCloseOutPack(viewer.role))
    return { ok: false, reason: 'sharer_lost_access' };

  return {
    ok: true,
    share: {
      shareId: row.id,
      packId: row.packId,
      label: row.label,
      includeZip: row.includeZip,
      expiresAt: row.expiresAt,
      sharedByName: row.createdByName,
      viewer,
    },
  };
}

/** Record an access. Never throws — a failed log must not break the view. */
export async function recordShareView(
  shareId: string,
  action: 'VIEW' | 'ZIP',
  ip: string | null,
): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.closeOutPackShareView.create({
        data: { shareId, action, ipHash: hashIp(ip) },
      }),
      prisma.closeOutPackShare.update({
        where: { id: shareId },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      }),
    ]);
  } catch {
    // Deliberately swallowed: an access-log failure is not a reason to deny a
    // client their handover document.
  }
}
