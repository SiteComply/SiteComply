import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toDateInputValue, zonedMidnightToUtc } from '@/lib/datetime';

/**
 * Headline figures for the admin dashboard summary cards.
 *
 *  - onSiteNow:     workers currently checked in (no checkout) on active sites,
 *                   matching the "On site now" view.
 *  - checkInsToday: submissions created since midnight Europe/London today.
 *  - activeSites:   sites with ACTIVE status.
 */
export interface DashboardStats {
  onSiteNow: number;
  checkInsToday: number;
  activeSites: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // Start of today in UK local time, expressed as the matching UTC instant.
  const startOfToday = zonedMidnightToUtc(toDateInputValue(new Date()));

  const [onSiteNow, checkInsToday, activeSites] = await Promise.all([
    prisma.submission.count({
      where: { checkedOutAt: null, jobSite: { status: SiteStatus.ACTIVE } },
    }),
    prisma.submission.count({
      where: { checkedInAt: { gte: startOfToday } },
    }),
    prisma.jobSite.count({ where: { status: SiteStatus.ACTIVE } }),
  ]);

  return { onSiteNow, checkInsToday, activeSites };
}
