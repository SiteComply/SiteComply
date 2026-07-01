import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PlatformUserList } from '@/components/admin/PlatformUserList';
import { listPlatformUsers } from '@/services/platformUsers/platformUserService';
import type {
  PlatformRoleValue,
  PlatformStatusValue,
} from '@/services/platformUsers/platformUserConstants';
import { formatUkMobileForDisplay } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/**
 * Admin Platform Users list. Add, search, approve, disable, edit and remove the
 * office/management accounts that will sign in via Platform Login. This is the
 * foundation for RBAC — sign-in and permission enforcement come later.
 */
export default async function PlatformUsersPage() {
  const users = await listPlatformUsers();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Platform Users</h1>
          <p className="text-ink-muted">
            Manage who can access the SiteComply platform, their role and
            assigned sites. Sign-in and permissions are added in a later stage.
          </p>
        </div>
        <Link href="/admin/platform-users/new" className="shrink-0">
          <Button size="md">Add user</Button>
        </Link>
      </header>

      <PlatformUserList
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          company: u.company,
          email: u.email,
          mobile: u.mobile ? formatUkMobileForDisplay(u.mobile) : null,
          role: u.role as PlatformRoleValue,
          status: u.status as PlatformStatusValue,
          siteCount: u.assignedSites.length,
        }))}
      />
    </div>
  );
}
