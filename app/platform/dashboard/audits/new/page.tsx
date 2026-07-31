import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { AuditForm } from '@/components/platform/AuditForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { listReferenceableDocuments } from '@/services/audits/auditService';
import { listActiveTemplatesForSites } from '@/services/audits/auditTemplateService';

export const dynamic = 'force-dynamic';

/**
 * New audit workflow — capture the audit's title, site, description,
 * observations, an optional overall score and any referenced documents. Gated on
 * the audits "create" permission; sites and documents are limited to scope.
 */
export default async function NewAuditPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');
  if (!permits(viewer.role, 'audits', 'create')) {
    redirect('/platform/dashboard/audits');
  }

  const sites = viewer.sites
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ id: s.id, name: s.name, jobReference: s.jobReference }));
  const documents = await listReferenceableDocuments(viewer);
  // SC-021 — carries each template's disabled sites so the form can narrow the
  // list as the site selection changes, the same way it already narrows
  // referenceable documents.
  const templates = (
    await listActiveTemplatesForSites(sites.map((x) => x.id))
  ).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    itemCount: t.itemCount,
    disabledSiteIds: t.disabledSiteIds,
  }));

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href="/platform/dashboard/audits"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Audits
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">New audit</h1>
        <p className="text-ink-muted">
          Start an audit for one of your sites. Findings, actions and photos
          come in a later phase.
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
          You have no active sites to audit.
        </p>
      ) : (
        <AuditForm
          mode="create"
          sites={sites}
          documents={documents}
          templates={templates}
        />
      )}
    </PlatformShell>
  );
}
