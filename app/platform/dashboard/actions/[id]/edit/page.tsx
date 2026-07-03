import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { ActionForm } from '@/components/platform/ActionForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getActionForViewer } from '@/services/actions/actionService';
import { toDateInputValue } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Edit an action. Gated on the actions "edit" permission; sites are limited to
 * the viewer's scope.
 */
export default async function EditActionPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'actions');
  if (!permits(viewer.role, 'actions', 'edit')) {
    redirect(`/platform/dashboard/actions/${params.id}`);
  }

  const action = await getActionForViewer(viewer, params.id);
  if (!action) notFound();

  // Offer active sites plus the action's current site (even if archived).
  const siteMap = new Map<string, { id: string; name: string; jobReference: string }>();
  for (const s of viewer.sites) {
    if (s.status === 'ACTIVE' || s.id === action.jobSiteId) {
      siteMap.set(s.id, { id: s.id, name: s.name, jobReference: s.jobReference });
    }
  }

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link href={`/platform/dashboard/actions/${action.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          ← Back to action
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Edit action</h1>
        <p className="text-ink-muted">Update the action details, priority, due date or assignee.</p>
      </div>

      <ActionForm
        mode="edit"
        actionId={action.id}
        sites={[...siteMap.values()]}
        initial={{
          title: action.title,
          jobSiteId: action.jobSiteId,
          priority: action.priority,
          status: action.status,
          dueDate: action.dueDate ? toDateInputValue(action.dueDate) : '',
          assignedTo: action.assignedTo ?? '',
          description: action.description ?? '',
        }}
      />
    </PlatformShell>
  );
}
