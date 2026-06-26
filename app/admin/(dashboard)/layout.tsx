import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { getAdminSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Guard for every admin dashboard route. Any request without a valid admin
 * session is redirected to sign-in, so all pages in this route group are
 * protected in one place. The /admin/login page sits outside this group.
 */
export default function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  return (
    <AdminShell adminName={session.name} adminRole={session.role}>
      {children}
    </AdminShell>
  );
}
