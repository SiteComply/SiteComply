import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { AuditTemplateForm } from '@/components/platform/AuditTemplateForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';

export const dynamic = 'force-dynamic';

/** New audit template (SC-013). Any audit-creating role. */
export default async function NewAuditTemplatePage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');
  if (!permits(viewer.role, 'audits', 'create')) {
    redirect('/platform/dashboard/audits/templates');
  }

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href="/platform/dashboard/audits/templates"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Audit templates
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">New audit template</h1>
        <p className="text-ink-muted">
          A reusable audit format that can be applied when creating audits on
          any site.
        </p>
      </div>
      <AuditTemplateForm mode="create" />
    </PlatformShell>
  );
}
