import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { AdminInductionVideoWorkspace } from '@/components/admin/AdminInductionVideoWorkspace';
import { LibrarySection } from '@/components/inductionVideo/LibrarySection';
import { libraryRowsForEditor } from '@/services/inductionVideo/libraryRows';

export const dynamic = 'force-dynamic';

/**
 * The company video library, in the Admin Centre — fully manageable.
 *
 * The same assets the Platform manages, through the same dispatcher and the same
 * component. An Admin Centre OWNER or ADMIN has authority equivalent to a Platform
 * Director for company content; a VIEWER reads.
 */
export default async function AdminInductionLibraryPage() {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const manages = adminCanManage(session.role);
  const { assets, modules, totalProjects } = await libraryRowsForEditor();

  return (
    <AdminInductionVideoWorkspace active="library">
      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        These are the same library videos managed in the Platform under{' '}
        <span className="font-semibold text-ink">Induction videos → Library</span>,
        not a copy of them. Issuing one changes every project’s induction, and the
        history records that it came from the Admin Centre.
        {!manages && ' Your role can view these but not change them.'}
      </p>
      <LibrarySection
        assets={assets}
        modules={modules}
        canDraft={manages}
        canIssue={manages}
        endpoint="/api/admin/induction-library"
        totalProjects={totalProjects}
        detailHref={(id) => `/admin/induction-videos/library/${id}`}
      />
    </AdminInductionVideoWorkspace>
  );
}
