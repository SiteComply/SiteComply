import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { AuditTemplateActions } from '@/components/platform/AuditTemplateActions';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canManageAuditTemplates,
} from '@/services/platformUsers/platformPermissions';
import { listAllTemplates } from '@/services/audits/auditTemplateService';

export const dynamic = 'force-dynamic';

/**
 * Audit Template library (SC-013). An organisation-level list of reusable audit
 * formats. Any audit-creating role can add a template; editing/deleting shared
 * templates is restricted to the template-management roles.
 */
export default async function AuditTemplatesPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');

  const templates = await listAllTemplates();
  const canCreate = permits(viewer.role, 'audits', 'create');
  const canManage = canManageAuditTemplates(viewer.role);

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/platform/dashboard/audits"
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            ← Audits
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-ink">Audit templates</h1>
          <p className="text-ink-muted">
            Reusable audit formats shared across your organisation’s sites.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/platform/dashboard/audits/templates/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
          >
            New template
          </Link>
        )}
      </header>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {templates.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            No audit templates yet.
            {canCreate && ' Use “New template” to create one.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{t.name}</p>
                    {t.isSystem && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                        Starter
                      </span>
                    )}
                    {!t.active && (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                        Inactive
                      </span>
                    )}
                    <span className="text-xs text-ink-subtle">
                      v{t.version} · {t.itemCount} item
                      {t.itemCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {t.description && (
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {t.description}
                    </p>
                  )}
                </div>
                {canManage && (
                  <AuditTemplateActions
                    id={t.id}
                    active={t.active}
                    isSystem={t.isSystem}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PlatformShell>
  );
}
