import { prisma } from '@/lib/prisma';
import {
  getNotificationThresholds,
  reminderOffsets,
} from '@/services/notifications/notificationConfigService';
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
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';

/**
 * Document-expiry notifications — DERIVED on read from documents' expiry dates +
 * the configured reminder thresholds, mapped into the unified RawNotification
 * shape consumed by services/notifications/platformNotifications. Nothing is
 * produced when the `document_expiry` notification type is disabled, when the
 * viewer lacks documents "view", or for sites outside the viewer's scope.
 */

export const DOCUMENT_EXPIRY_NOTIFICATION_TYPE = 'document_expiry';

/**
 * FALLBACK ONLY. The lead time is organisation-configurable (Settings ->
 * Notifications); these are what applies before anyone has set one, and they
 * are the values this file used when they were hard-coded.
 */
export const DOCUMENT_EXPIRY_THRESHOLDS = [30, 14, 7] as const;
const EXPIRY_STEPS = [14, 7];
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
  // Organisation-configurable lead time, widest first. Read per call so a
  // change applies to the next request rather than the next restart.
  const { documentExpiryDays } = await getNotificationThresholds();
  const expiryThresholds = reminderOffsets(documentExpiryDays, EXPIRY_STEPS);
  const cutoff = new Date(todayMs + expiryThresholds[0]! * DAY_MS);

  // One document, one reminder. An annotated pair shares an expiry date, so an
  // unfiltered read fires the same reminder twice per threshold — two rows,
  // identical titles, one real document. The superseded original is excluded.
  const superseded = await supersededDocumentIds(viewer.siteIds);
  const docs = await prisma.document.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      expiresAt: { not: null, lte: cutoff },
      id: superseded.length > 0 ? { notIn: superseded } : undefined,
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
    const crossed = expiryThresholds.filter((t) => daysUntilExpiry <= t);
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
