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
