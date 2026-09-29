import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { ModuleDetail } from '@/components/inductionModules/ModuleDetail';
import { moduleDetail } from '@/services/inductionModules/moduleDetail';

export const dynamic = 'force-dynamic';

/**
 * One company module, in the Admin Centre — fully manageable.
 *
 * The same working surface over the same data through the same dispatcher. An
 * Admin Centre OWNER or ADMIN has authority equivalent to a Platform Director for
 * company content, by the owner's decision; a VIEWER reads it and every action is
 * refused by the route and again by the service.
 */
export default async function AdminModuleDetailPage({
  params,
}: {
  params: { moduleId: string };
}) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const detail = await moduleDetail(params.moduleId);
  if (!detail) notFound();

  const manages = adminCanManage(session.role);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/induction-videos/modules"
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        ← Company modules
      </Link>
      <ModuleDetail
        detail={detail}
        canDraft={manages}
        canIssue={manages}
        endpoint="/api/admin/induction-modules"
        backHref="/admin/induction-videos/modules"
        libraryBasePath="/admin/induction-videos/library"
      />
    </div>
  );
}
