import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  isNotificationEnabled,
  getNotificationChannels,
} from '@/services/notifications/notificationConfigService';
import type { NotificationChannelKey } from '@/services/notifications/notificationCatalog';
import {
  documentCategoryLabel,
  DOCUMENT_EXPIRY_LABEL,
  DOCUMENT_EXPIRY_BADGE,
} from '@/services/documents/documentConstants';
import { formatDateUK } from '@/lib/datetime';
import type { RawNotification } from '@/services/notifications/notificationTypes';

/**
 * Document-expiry notifications — DERIVED on read from documents' expiry dates +
 * the configured reminder thresholds, mapped into the unified RawNotification
 * shape consumed by services/notifications/platformNotifications. Nothing is
 * produced when the `document_expiry` notification type is disabled, when the
 * viewer lacks documents "view", or for sites outside the viewer's scope.
 */

export const DOCUMENT_EXPIRY_NOTIFICATION_TYPE = 'document_expiry';

/** Reminder thresholds (days before expiry). Central, single source of truth. */
export const DOCUMENT_EXPIRY_THRESHOLDS = [30, 14, 7] as const;
const MAX_THRESHOLD = Math.max(...DOCUMENT_EXPIRY_THRESHOLDS);
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

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
 * Derive the viewer's document-expiry notifications (without read state) as
 * unified RawNotification items. Site-scoped + RBAC-gated + settings-gated.
 */
export async function deriveDocumentNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  if (viewer.siteIds.length === 0) return [];
  if (!permits(viewer.role, 'documents', 'view')) return [];
  if (!(await isNotificationEnabled(DOCUMENT_EXPIRY_NOTIFICATION_TYPE))) return [];

  const todayMs = utcDay(now);
  const cutoff = new Date(todayMs + MAX_THRESHOLD * DAY_MS); // today + 30 days

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

  const out: RawNotification[] = [];
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const daysUntilExpiry = Math.round((utcDay(d.expiresAt) - todayMs) / DAY_MS);
    const context = `${documentCategoryLabel(d.category)} · ${d.jobSite.name}`;
    const meta = `${d.fileName} · expires ${formatDateUK(d.expiresAt)}`;
    const href = `/platform/dashboard/documents/${d.id}`;

    if (daysUntilExpiry < 0) {
      out.push({
        key: documentExpiryNotificationKey(d.id, null),
        group: 'DOC_EXPIRED',
        title: d.title,
        message: expiredMessage(daysUntilExpiry),
        context,
        meta,
        href,
        badgeLabel: DOCUMENT_EXPIRY_LABEL.EXPIRED,
        badgeClass: DOCUMENT_EXPIRY_BADGE.EXPIRED,
        chip: null,
        urgency: daysUntilExpiry,
      });
      continue;
    }
    const crossed = DOCUMENT_EXPIRY_THRESHOLDS.filter((t) => daysUntilExpiry <= t);
    if (crossed.length === 0) continue;
    const threshold = Math.min(...crossed);
    out.push({
      key: documentExpiryNotificationKey(d.id, threshold),
      group: 'DOC_EXPIRING',
      title: d.title,
      message: expiringMessage(daysUntilExpiry),
      context,
      meta,
      href,
      badgeLabel: DOCUMENT_EXPIRY_LABEL.EXPIRING_SOON,
      badgeClass: DOCUMENT_EXPIRY_BADGE.EXPIRING_SOON,
      chip: `${threshold}-day reminder`,
      urgency: daysUntilExpiry,
    });
  }
  return out;
}

/**
 * The delivery channels enabled for document-expiry notifications (email / SMS).
 * Empty until those channels ship; a future scheduled delivery worker reads this
 * to decide where to send — no code changes needed here when channels launch.
 */
export async function getDocumentExpiryChannels(): Promise<NotificationChannelKey[]> {
  return getNotificationChannels(DOCUMENT_EXPIRY_NOTIFICATION_TYPE);
}
