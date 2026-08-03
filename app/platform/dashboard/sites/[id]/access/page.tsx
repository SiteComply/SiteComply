import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { Section } from '@/components/platform/siteDetailUi';
import { SiteAccessManager } from '@/components/platform/SiteAccessManager';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  getSiteAccess,
  getSiteAccessHistory,
  canManageContractorAccess,
} from '@/services/platformUsers/contractorAccessService';
import { listPermissionTemplates } from '@/services/platformUsers/permissionTemplateService';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-022 Phase 1 — Site Details → Access.
 *
 * Per-project contractor permissions, which is what the requirement asks for:
 * the same person can hold different access on different projects, so this
 * belongs on the site rather than on the user record. Managing the user record
 * itself stays Admin Centre territory; this only narrows what they see here and
 * removes them from this site.
 */
export default async function SiteAccessPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageContractorAccess(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const users = await getSiteAccess(viewer, params.id);
  if (!users) notFound();
  const history = (await getSiteAccessHistory(viewer, params.id, 20)) ?? [];
  // SC-022 Phase 2 — saved templates offered per user.
  const templates = (await listPermissionTemplates()).map((t) => ({
    id: t.id,
    name: t.name,
  }));

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="access" />

      <Section title="Who can see this site">
        <p className="mb-4 text-sm text-ink-muted">
          Everyone assigned to this project, and what each of them can see.
          Access can only be reduced from what their role already allows.
        </p>
        <SiteAccessManager
          siteId={params.id}
          users={users}
          canManage={canManageContractorAccess(viewer.role)}
          templates={templates}
        />
      </Section>

      {/* UX REFRESH PHASE 4 — the history is evidence you consult, not status
          you check, so it no longer occupies a screen of its own by default. */}
      <details className="group mt-4 rounded-xl border border-line bg-surface shadow-card">
        <summary className="touch-target cursor-pointer list-none px-4 py-3 text-sm font-bold text-ink marker:content-none">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="text-ink-subtle transition-transform group-open:rotate-90"
            >
              ›
            </span>
            Access history
            <span className="font-normal text-ink-subtle">
              ({history.length})
            </span>
          </span>
        </summary>
        <div className="border-t border-line p-4">
          {history.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              No access changes recorded for this site yet.
            </p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <p className="text-ink">
                    <b>{h.actorName}</b>{' '}
                    {h.action === 'REVOKE_SITE'
                      ? 'removed'
                      : h.action === 'APPLY_PRESET'
                        ? 'applied a preset to'
                        : h.action === 'RESET'
                          ? 'restored full access for'
                          : 'changed access for'}{' '}
                    <b>{h.targetName}</b>
                    {h.module && h.action === 'NARROW' ? ` · ${h.module}` : ''}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {formatDateTimeUK(h.createdAt)}
                    {h.action === 'NARROW'
                      ? ` · ${h.beforeVerbs.join('/') || 'none'} → ${h.afterVerbs.join('/') || 'none'}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </PlatformShell>
  );
}
