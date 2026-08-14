import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { getAdminSession } from '@/lib/session';
import { countPendingAccessRequests } from '@/services/accessRequests/accessRequestService';

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

  // COUNTED UNCONDITIONALLY.
  //
  // This was gated on isNotificationEnabled('platform_access_request'), which
  // has returned false since that key was removed from the notification
  // catalogue — isNotificationEnabled returns false for any type it does not
  // know. The gate was therefore permanently closed and the badge could never
  // appear, however many requests were waiting.
  //
  // The gate is not reinstated against a live key either: this badge is not a
  // notification. It is the count of work sitting in the queue on the screen
  // that owns that queue, and an admin silencing a notification is not asking
  // to be shown a smaller number than the truth.
  const pendingAccessRequests = await countPendingAccessRequests();

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
