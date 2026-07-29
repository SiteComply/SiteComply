import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { AuditTemplateForm } from '@/components/platform/AuditTemplateForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canManageAuditTemplates } from '@/services/platformUsers/platformPermissions';
import { getTemplate } from '@/services/audits/auditTemplateService';

export const dynamic = 'force-dynamic';

/** Edit an audit template (SC-013). Restricted to template-management roles. */
export default async function EditAuditTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');
  if (!canManageAuditTemplates(viewer.role)) {
    redirect('/platform/dashboard/audits/templates');
  }

  const template = await getTemplate(params.id);
  if (!template) notFound();

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href="/platform/dashboard/audits/templates"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Audit templates
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">
          Edit audit template
        </h1>
        <p className="text-ink-muted">
          Editing bumps the template version; existing audits created from it
          are unaffected.
        </p>
      </div>
      <AuditTemplateForm
        mode="edit"
        templateId={template.id}
        initial={{
          name: template.name,
          description: template.description ?? '',
          items: template.items.map((it) => ({
            label: it.label,
            helpText: it.helpText ?? '',
            category: it.category,
            defaultSeverity: it.defaultSeverity ?? '',
          })),
        }}
      />
    </PlatformShell>
  );
}
