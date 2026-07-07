import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isNotificationEnabled,
  getNotificationChannels,
} from '@/services/notifications/notificationConfigService';
import type { NotificationChannelKey } from '@/services/notifications/notificationCatalog';
import { getReadNotificationKeys } from '@/services/notifications/notificationReadService';

/**
 * Automated document-expiry notifications.
 *
 * Rather than a scheduled job writing rows, these are DERIVED on read from the
 * documents' expiry dates + the configured reminder thresholds — always current,
 * naturally site-scoped, and with no duplicate-send bookkeeping (the same pattern
 * the Actions register uses for "overdue"). The result is shown in-app.
 *
 * They plug into the existing notifications framework: nothing is generated when
 * the `document_expiry` notification type is disabled in Admin → Settings →
 * Notifications, and the enabled delivery channels are read from that same config
 * so a future scheduled worker can send these over email / SMS by reusing
 * getDocumentExpiryNotifications() + getDocumentExpiryChannels() — no changes here.
 */

export const DOCUMENT_EXPIRY_NOTIFICATION_TYPE = 'document_expiry';

/** Reminder thresholds (days before expiry). Central, single source of truth. */
export const DOCUMENT_EXPIRY_THRESHOLDS = [30, 14, 7] as const;
const MAX_THRESHOLD = Math.max(...DOCUMENT_EXPIRY_THRESHOLDS);
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export type ExpiryNotificationStatus = 'EXPIRING_SOON' | 'EXPIRED';

export interface DocumentExpiryNotification {
  /** Stable per-reminder identity (incl. threshold), used for read-state. */
  key: string;
  /** Whether this user has marked it read. */
  read: boolean;
  documentId: string;
  title: string;
  fileName: string;
  category: string;
  jobSiteId: string;
  jobSiteName: string;
  expiresAt: string; // ISO
  status: ExpiryNotificationStatus;
  /** Whole days until expiry; negative once expired. */
  daysUntilExpiry: number;
  /** The reminder threshold (30/14/7) currently in effect; null for expired. */
  threshold: number | null;
  message: string;
}

/**
 * A notification's stable identity string. Includes the reminder level so that
 * when a document escalates to the next threshold it reads as a fresh (unread)
 * reminder even if the previous level was marked read.
 */
export function documentExpiryNotificationKey(
  documentId: string,
  threshold: number | null,
): string {
  return `${DOCUMENT_EXPIRY_NOTIFICATION_TYPE}:${documentId}:${threshold === null ? 'expired' : `t${threshold}`}`;
}

function expiringMessage(days: number): string {
  if (days <= 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

function expiredMessage(days: number): string {
  const ago = Math.abs(days);
  return ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago`;
}

/**
 * The viewer's current document-expiry notifications, most urgent first
 * (expired, then soonest expiry). Site-scoped to the viewer's Assigned Sites.
 * Returns [] when the notification type is disabled or the viewer has no sites.
 */
export async function getDocumentExpiryNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<DocumentExpiryNotification[]> {
  if (viewer.siteIds.length === 0) return [];
  if (!(await isNotificationEnabled(DOCUMENT_EXPIRY_NOTIFICATION_TYPE))) return [];

  const todayMs = utcDay(now);
  const cutoff = new Date(todayMs + MAX_THRESHOLD * DAY_MS); // today + 30 days

  // Documents in scope that are already expired or expiring within the window.
  const docs = await prisma.document.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      expiresAt: { not: null, lte: cutoff },
    },
    orderBy: { expiresAt: 'asc' },
    select: {
      id: true,
      title: true,
      fileName: true,
      category: true,
      expiresAt: true,
      jobSite: { select: { id: true, name: true } },
    },
  });

  const out: Omit<DocumentExpiryNotification, 'read'>[] = [];
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const daysUntilExpiry = Math.round((utcDay(d.expiresAt) - todayMs) / DAY_MS);
    const common = {
      documentId: d.id,
      title: d.title,
      fileName: d.fileName,
      category: d.category,
      jobSiteId: d.jobSite.id,
      jobSiteName: d.jobSite.name,
      expiresAt: d.expiresAt.toISOString(),
      daysUntilExpiry,
    };

    if (daysUntilExpiry < 0) {
      out.push({
        ...common,
        key: documentExpiryNotificationKey(d.id, null),
        status: 'EXPIRED',
        threshold: null,
        message: expiredMessage(daysUntilExpiry),
      });
      continue;
    }
    // Expiring soon — the active reminder is the smallest crossed threshold.
    const crossed = DOCUMENT_EXPIRY_THRESHOLDS.filter((t) => daysUntilExpiry <= t);
    if (crossed.length === 0) continue; // outside all reminder windows
    const threshold = Math.min(...crossed);
    out.push({
      ...common,
      key: documentExpiryNotificationKey(d.id, threshold),
      status: 'EXPIRING_SOON',
      threshold,
      message: expiringMessage(daysUntilExpiry),
    });
  }

  // Annotate each with the user's read state (absent row = unread).
  const readKeys = await getReadNotificationKeys(viewer.id, out.map((n) => n.key));
  const notifications: DocumentExpiryNotification[] = out.map((n) => ({
    ...n,
    read: readKeys.has(n.key),
  }));

  // Expired first (most negative days), then soonest to expire.
  notifications.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return notifications;
}

/** Count of the viewer's UNREAD document-expiry notifications (for the nav badge). */
export async function countUnreadDocumentExpiryNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<number> {
  const notifications = await getDocumentExpiryNotifications(viewer, now);
  return notifications.filter((n) => !n.read).length;
}

/**
 * The delivery channels enabled for document-expiry notifications (email / SMS).
 * Empty until those channels ship; a future scheduled delivery worker reads this
 * to decide where to send — no code changes needed here when channels launch.
 */
export async function getDocumentExpiryChannels(): Promise<NotificationChannelKey[]> {
  return getNotificationChannels(DOCUMENT_EXPIRY_NOTIFICATION_TYPE);
}
