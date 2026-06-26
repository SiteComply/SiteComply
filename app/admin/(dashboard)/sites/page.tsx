import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AdminSiteList } from '@/components/admin/AdminSiteList';
import { listSitesForAdmin } from '@/services/sites/adminSiteService';

export const dynamic = 'force-dynamic';

/**
 * Admin job sites list. Search across all sites, with archive/restore and links
 * to create or edit. (Guarded by the dashboard layout.)
 */
export default async function AdminSitesPage() {
  const sites = await listSitesForAdmin();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Job sites</h1>
          <p className="text-ink-muted">
            Manage your sites, induction content and emergency information.
          </p>
        </div>
        <Link href="/admin/sites/new" className="shrink-0">
          <Button size="md">New site</Button>
        </Link>
      </header>

      <AdminSiteList
        sites={sites.map((s) => ({
          id: s.id,
          name: s.name,
          jobReference: s.jobReference,
          town: s.town,
          postcode: s.postcode,
          status: s.status,
          onSiteCount: s.onSiteCount,
        }))}
      />
    </div>
  );
}
