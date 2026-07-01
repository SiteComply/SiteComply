import Link from 'next/link';
import { PlatformUserForm } from '@/components/admin/PlatformUserForm';
import { listSitesForAssignment } from '@/services/platformUsers/platformUserService';

export const dynamic = 'force-dynamic';

/** Add a new Platform User. */
export default async function NewPlatformUserPage() {
  const sites = await listSitesForAssignment();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/platform-users"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to platform users
        </Link>
        <h1 className="text-2xl font-bold text-ink">Add platform user</h1>
        <p className="text-ink-muted">
          Add someone to the SiteComply platform. They’re created as{' '}
          <strong>Pending</strong> until you approve them.
        </p>
      </header>

      <PlatformUserForm mode="create" sites={sites} />
    </div>
  );
}
