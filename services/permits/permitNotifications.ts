import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { isNotificationEnabled } from '@/services/notifications/notificationConfigService';
import { formatDateTimeUK } from '@/lib/datetime';
import type { RawNotification } from '@/services/notifications/notificationTypes';
import { permitStatusLabel } from '@/services/permits/permitConstants';

/**
 * Permit notifications (SC-009) — DERIVED on read from permits awaiting a
 * decision (SUBMITTED / UNDER_REVIEW), mapped into the unified RawNotification
 * shape. Gated by the `permit_awaiting` notification type, the `permits` view
 * permission and the viewer's Assigned Sites — the same boundary as the permits
 * list, so a manager only ever sees permits they can act on. This is the
 * site-manager side of "notify managers on submission".
 */

const BADGE = 'bg-hivis-400/25 text-ink';
const DAY_MS = 24 * 60 * 60 * 1000;

export async function derivePermitNotifications(
  viewer: PlatformViewer,
  now: Date = new Date(),
): Promise<RawNotification[]> {
  if (viewer.siteIds.length === 0) return [];
  if (!permits(viewer.role, 'permits', 'view')) return [];
  if (!(await isNotificationEnabled('permit_awaiting'))) return [];

  const rows = await prisma.permit.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
    },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      reference: true,
      permitTypeName: true,
      status: true,
      submittedByName: true,
      submittedAt: true,
      jobSite: { select: { name: true } },
    },
  });

  return rows.map((p) => {
    const ageDays = Math.floor(
      (now.getTime() - p.submittedAt.getTime()) / DAY_MS,
    );
    return {
      key: `permit_awaiting:${p.id}:${p.status}`,
      group: 'PERMIT_AWAITING',
      title: `${p.permitTypeName} — ${p.reference}`,
      message: `Requested by ${p.submittedByName}`,
      context: p.jobSite.name,
      meta: `Submitted ${formatDateTimeUK(p.submittedAt)}`,
      href: `/platform/dashboard/permits/${p.id}`,
      badgeLabel: permitStatusLabel(p.status),
      badgeClass: BADGE,
      chip: null,
      // Older-waiting permits sort as more urgent.
      urgency: -ageDays,
    };
  });
}
