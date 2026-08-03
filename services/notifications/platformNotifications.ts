import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReadNotificationKeys } from '@/services/notifications/notificationReadService';
import {
  NOTIFICATION_GROUP_META,
  type RawNotification,
  type PlatformNotification,
} from '@/services/notifications/notificationTypes';
import { deriveDocumentNotifications } from '@/services/documents/documentExpiryNotifications';
import { deriveActionNotifications } from '@/services/actions/actionNotifications';
import { deriveAuditNotifications } from '@/services/audits/auditNotifications';
import { derivePermitNotifications } from '@/services/permits/permitNotifications';
import { deriveComplianceNotifications } from '@/services/compliance/complianceNotifications';
import {
  deriveAssigneeNotifications,
  deriveAssigneeDueSoon,
} from '@/services/notifications/notificationEventService';

/**
 * Unified in-app notifications for a platform user.
 *
 * Notifications are DERIVED on read from multiple sources (document expiry,
 * action due/overdue/assignment, audit created/signed-off) into one common shape
 * (see notificationTypes), so the Notifications page, the nav badge and the
 * read/unread endpoints all speak the same model. Each source is independently:
 *  - gated by its notification type in Admin → Settings → Notifications,
 *  - gated by the viewer's module RBAC (documents / actions / audits "view"),
 *  - scoped to the viewer's Assigned Sites.
 * Read state is applied here (once) from NotificationRead. Adding a future source
 * is just another deriver returning RawNotification[].
 */

/** All of the viewer's current notifications, most urgent group first. */
export async function getPlatformNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<PlatformNotification[]> {
  // SC-016: assignee-addressed events are fetched even for a viewer with no
  // assigned sites — they are addressed to the PERSON, and the event is only ever
  // created for the assignee, so the recipient id is the authorisation.
  const addressed = [
    ...(await deriveAssigneeNotifications(viewer, now)),
    ...(await deriveAssigneeDueSoon(viewer, now)),
  ];
  if (viewer.siteIds.length === 0) {
    return applyReadState(viewer.id, addressed);
  }

  // SC-025 — "automated notifications are disabled" for a completed project.
  // Narrowing the viewer's sites HERE switches off all five site-scoped sources
  // at once; doing it in each deriver would be five chances to forget.
  //
  // The assignee-addressed events above are deliberately left alone: they are
  // addressed to a PERSON about a specific record, and no new ones can arise on
  // a completed project because the records they track can no longer change.
  const openSiteIds = await activeSiteIdsFrom(viewer.siteIds);
  if (openSiteIds.length === 0) {
    return applyReadState(viewer.id, addressed);
  }
  const openViewer: PlatformViewer = { ...viewer, siteIds: openSiteIds };

  const raw: RawNotification[] = [
    ...addressed,
    ...(await derivePermitNotifications(openViewer, now)),
    ...(await deriveActionNotifications(openViewer, now)),
    ...(await deriveDocumentNotifications(openViewer, now)),
    ...(await deriveAuditNotifications(openViewer, now)),
    // SC-020 Phase 2 — reminders/overdue are DERIVED, so they need no scheduler
    // and self-correct when a due date moves. Escalations arrive as stored
    // events through deriveAssigneeNotifications above.
    ...(await deriveComplianceNotifications(openViewer, now)),
  ];

  return applyReadState(viewer.id, raw);
}

/** Apply per-user read state and group ordering. One place, all sources. */
async function applyReadState(
  userId: string,
  raw: RawNotification[],
): Promise<PlatformNotification[]> {
  const readKeys = await getReadNotificationKeys(
    userId,
    raw.map((r) => r.key),
  );
  const list: PlatformNotification[] = raw.map((r) => ({
    ...r,
    read: readKeys.has(r.key),
  }));

  list.sort((a, b) => {
    const oa = NOTIFICATION_GROUP_META[a.group].order;
    const ob = NOTIFICATION_GROUP_META[b.group].order;
    return oa !== ob ? oa - ob : a.urgency - b.urgency;
  });
  return list;
}

/** Unread count across all sources — for the nav badge. */
export async function countUnreadPlatformNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<number> {
  const list = await getPlatformNotifications(viewer, now);
  return list.filter((n) => !n.read).length;
}

/**
 * Of these site ids, the ones whose project is still open.
 *
 * A completed project raises no automated notifications — the work has stopped
 * and its records are frozen, so a reminder about them is noise addressed to
 * someone who cannot act on it.
 */
async function activeSiteIdsFrom(siteIds: string[]): Promise<string[]> {
  const open = await prisma.jobSite.findMany({
    where: { id: { in: siteIds }, status: { not: 'COMPLETED' } },
    select: { id: true },
  });
  return open.map((s) => s.id);
}
