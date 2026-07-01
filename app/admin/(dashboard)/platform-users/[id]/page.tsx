import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformUserForm } from '@/components/admin/PlatformUserForm';
import {
  getPlatformUserById,
  listSitesForAssignment,
} from '@/services/platformUsers/platformUserService';
import { formatUkMobileForDisplay } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/** Edit an existing Platform User. */
export default async function EditPlatformUserPage({
  params,
}: {
  params: { id: string };
}) {
  const [user, sites] = await Promise.all([
    getPlatformUserById(params.id),
    listSitesForAssignment(),
  ]);
  if (!user) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/platform-users"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to platform users
        </Link>
        <h1 className="text-2xl font-bold text-ink">Edit platform user</h1>
        <p className="text-ink-muted">
          {user.name} · {user.company}
        </p>
      </header>

      <PlatformUserForm
        mode="edit"
        userId={user.id}
        sites={sites}
        initial={{
          name: user.name,
          company: user.company,
          email: user.email,
          mobile: user.mobile ? formatUkMobileForDisplay(user.mobile) : '',
          role: user.role,
          status: user.status,
          assignedSiteIds: user.assignedSites.map((s) => s.id),
        }}
      />
    </div>
  );
}
