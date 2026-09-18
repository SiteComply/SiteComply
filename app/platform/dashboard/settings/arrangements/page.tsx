import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { ArrangementsEditor } from '@/components/platform/ArrangementsEditor';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canEditSite } from '@/services/platformUsers/platformPermissions';
import { getStandardArrangements } from '@/services/sites/arrangementService';
import { CPP_ARRANGEMENTS } from '@/services/sites/cppArrangements';

export const dynamic = 'force-dynamic';

/**
 * CPP Tier 3A — company standard management arrangements.
 *
 * Written once here and inherited by every site's Construction Phase Plan. A
 * Director owns them: they are organisational policy, not site detail.
 */
export default async function StandardArrangementsPage() {
  const viewer = await requirePlatformViewer();
  const standards = await getStandardArrangements();
  // Viewing follows the settings area; editing is Director-only and is
  // re-checked in the service, so a read-only view is safe for everyone else.
  const canEdit = canEditSite(viewer.role);
  if (!viewer) notFound();

  return (
    <PlatformShell>
      <SettingsWorkspace active="arrangements">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-ink">
            Standard management arrangements
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            The management arrangements a Construction Phase Plan is expected to
            set out. Written once here and used by every project, unless a site
            records its own version.
          </p>
          {!canEdit && (
            <p className="mt-2 rounded-lg border border-line bg-surface-sunken p-3 text-sm text-ink-muted">
              These are company policy and can only be edited by a Director. You
              can still write a site-specific version on any site you manage.
            </p>
          )}
        </div>

        <ArrangementsEditor
          level="COMPANY"
          endpoint="/api/platform/settings/arrangements"
          canEdit={canEdit}
          initial={CPP_ARRANGEMENTS.map((a) => ({
            key: a.key,
            content: standards[a.key] ?? null,
          }))}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
