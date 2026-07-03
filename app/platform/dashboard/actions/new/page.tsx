import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { ActionForm } from '@/components/platform/ActionForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';

export const dynamic = 'force-dynamic';

/**
 * New action workflow — title, site, priority, status, due date, assignee and
 * description. Gated on the actions "create" permission; sites are limited to
 * the viewer's scope.
 */
export default async function NewActionPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'actions');
  if (!permits(viewer.role, 'actions', 'create')) {
    redirect('/platform/dashboard/actions');
  }

  const sites = viewer.sites
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ id: s.id, name: s.name, jobReference: s.jobReference }));

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link href="/platform/dashboard/actions" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Actions
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">New action</h1>
        <p className="text-ink-muted">
          Raise a corrective action or follow-up task for one of your sites.
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
          You have no active sites to raise an action for.
        </p>
      ) : (
        <ActionForm mode="create" sites={sites} />
      )}
    </PlatformShell>
  );
}
