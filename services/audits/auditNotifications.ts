import { AuditStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { isNotificationEnabled } from '@/services/notifications/notificationConfigService';
import { formatDateUK } from '@/lib/datetime';
import type { RawNotification } from '@/services/notifications/notificationTypes';

/**
 * Audit notifications — DERIVED on read from audits, mapped into the unified
 * RawNotification shape. Two triggers, each gated by its own notification type in
 * Admin → Settings → Notifications:
 *   - audit_created     → audits created in the last 7 days
 *   - audit_signed_off  → audits signed off in the last 7 days
 * Both are gated by the audits "view" permission and scoped to the viewer's
 * Assigned Sites (jobSiteId ∈ siteIds), so a notification is only ever visible to
 * a user who can access that audit — the same boundary as getAuditForViewer.
 *
 * (Due-soon / overdue audit triggers are deferred until audits carry a due date.)
 */

const CREATED_WINDOW_DAYS = 7;
const SIGNED_OFF_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const CREATED_BADGE = 'bg-brand-50 text-brand-700';
const SIGNED_OFF_BADGE = 'bg-safe-50 text-safe-700';

export async function deriveAuditNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  if (viewer.siteIds.length === 0) return [];
  if (!permits(viewer.role, 'audits', 'view')) return [];

  const [createdEnabled, signedOffEnabled] = await Promise.all([
    isNotificationEnabled('audit_created'),
    isNotificationEnabled('audit_signed_off'),
  ]);
  if (!createdEnabled && !signedOffEnabled) return [];

  const todayMs = utcDay(now);
  const out: RawNotification[] = [];

  // --- Newly created audits (created within the window) ---
  if (createdEnabled) {
    const since = new Date(now.getTime() - CREATED_WINDOW_DAYS * DAY_MS);
    const audits = await prisma.audit.findMany({
      where: { jobSiteId: { in: viewer.siteIds }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        createdByName: true,
        jobSite: { select: { name: true } },
      },
    });

    for (const a of audits) {
      const daysSince = Math.round((todayMs - utcDay(a.createdAt)) / DAY_MS);
      out.push({
        key: `audit_created:${a.id}`,
        group: 'AUDIT_CREATED',
        title: a.title,
        message: a.createdByName ? `Created by ${a.createdByName}` : 'New audit created',
        context: a.jobSite.name,
        meta: `Created ${formatDateUK(a.createdAt)}`,
        href: `/platform/dashboard/audits/${a.id}`,
        badgeLabel: 'New audit',
        badgeClass: CREATED_BADGE,
        chip: null,
        urgency: daysSince,
      });
    }
  }

  // --- Signed-off audits (signed off within the window) ---
  if (signedOffEnabled) {
    const since = new Date(now.getTime() - SIGNED_OFF_WINDOW_DAYS * DAY_MS);
    const audits = await prisma.audit.findMany({
      where: {
        jobSiteId: { in: viewer.siteIds },
        status: AuditStatus.SIGNED_OFF,
        signedOffAt: { not: null, gte: since },
      },
      orderBy: { signedOffAt: 'desc' },
      select: {
        id: true,
        title: true,
        signedOffAt: true,
        signedOffByName: true,
        overallScore: true,
        jobSite: { select: { name: true } },
      },
    });

    for (const a of audits) {
      if (!a.signedOffAt) continue;
      const daysSince = Math.round((todayMs - utcDay(a.signedOffAt)) / DAY_MS);
      out.push({
        // signedOffAt in the key → a re-sign after a reopen reads as a fresh unread.
        key: `audit_signed_off:${a.id}:${a.signedOffAt.getTime()}`,
        group: 'AUDIT_SIGNED_OFF',
        title: a.title,
        message: a.signedOffByName ? `Signed off by ${a.signedOffByName}` : 'Audit signed off',
        context: a.jobSite.name,
        meta: `Signed off ${formatDateUK(a.signedOffAt)}`,
        href: `/platform/dashboard/audits/${a.id}`,
        badgeLabel: 'Signed off',
        badgeClass: SIGNED_OFF_BADGE,
        chip: a.overallScore != null ? `Score ${a.overallScore}%` : null,
        urgency: daysSince,
      });
    }
  }

  return out;
}
