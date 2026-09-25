import { notFound, redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { AdminInductionVideoWorkspace } from '@/components/admin/AdminInductionVideoWorkspace';
import { LibraryAssetDetail } from '@/components/inductionVideo/LibraryAssetDetail';
import { libraryAssetDetail } from '@/services/inductionVideo/libraryDetail';
import { listModules } from '@/services/inductionModules/inductionModuleService';

export const dynamic = 'force-dynamic';

/**
 * One library video, in the Admin Centre. The same page the Platform shows over the
 * same data: only the shell and the endpoint differ, so the two cannot drift.
 */
export default async function AdminLibraryAssetPage({ params }: { params: { assetId: string } }) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');
  const manages = adminCanManage(session.role);

  const [asset, modules] = await Promise.all([
    libraryAssetDetail(params.assetId),
    listModules(),
  ]);
  if (!asset) notFound();

  return (
    <AdminInductionVideoWorkspace active="library">
      <LibraryAssetDetail
        asset={asset}
        modules={modules.map((m: { id: string; title: string }) => ({ id: m.id, title: m.title }))}
        canDraft={manages}
        canIssue={manages}
        endpoint="/api/admin/induction-library"
        backHref="/admin/induction-videos/library"
      />
    </AdminInductionVideoWorkspace>
  );
}
