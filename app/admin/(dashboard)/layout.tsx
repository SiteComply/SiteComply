import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { getAdminSession } from '@/lib/session';
import { countPendingAccessRequests } from '@/services/accessRequests/accessRequestService';
import { isNotificationEnabled } from '@/services/notifications/notificationConfigService';

export const dynamic = 'force-dynamic';

/**
 * Guard for every admin dashboard route. Any request without a valid admin
 * session is redirected to sign-in, so all pages in this route group are
 * protected in one place. The /admin/login page sits outside this group.
 *
 * The pending access-request count is read here (the layout is force-dynamic,
 * so it re-runs on every navigation and after router.refresh()) and passed to
 * the shell for the nav badge — keeping it in step as requests are actioned.
 */
export default async function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  // The nav badge is the in-app surface of the "new platform access requests"
  // notification — suppress it when an admin has turned that notification off.
  const accessRequestNotifications = await isNotificationEnabled('platform_access_request');
  const pendingAccessRequests = accessRequestNotifications
    ? await countPendingAccessRequests()
    : 0;

  return (
    <AdminShell
      adminName={session.name}
      adminRole={session.role}
      pendingAccessRequests={pendingAccessRequests}
    >
      {children}
    </AdminShell>
  );
}
