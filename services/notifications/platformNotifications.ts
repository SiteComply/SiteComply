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

  const raw: RawNotification[] = [
    ...addressed,
    ...(await derivePermitNotifications(viewer, now)),
    ...(await deriveActionNotifications(viewer, now)),
    ...(await deriveDocumentNotifications(viewer, now)),
    ...(await deriveAuditNotifications(viewer, now)),
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
