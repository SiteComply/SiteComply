import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { ModulesArchive } from '@/components/inductionModules/ModulesArchive';
import { retiredModuleRows } from '@/services/inductionModules/moduleRows';

export const dynamic = 'force-dynamic';

/**
 * Retired company modules, in the Admin Centre — the same archive over the same data.
 *
 * Open to any signed-in admin including VIEWER: reading what was retired is exactly
 * what a read-only role is for, and nothing here changes anything.
 */
export default async function AdminModulesArchivePage() {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const modules = await retiredModuleRows();

  return (
    <ModulesArchive
      modules={modules}
      backHref="/admin/induction-videos/modules"
      basePath="/admin/induction-videos/modules"
    />
  );
}
