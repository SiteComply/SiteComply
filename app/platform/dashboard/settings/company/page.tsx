import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { CompanyProfileSettings } from '@/components/platform/CompanyProfileSettings';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canManageSiteConfigTemplates,
  canManageCompanyProfile,
} from '@/services/platformUsers/platformPermissions';
import { getPlatformCompanyProfile } from '@/services/company/companyConfigService';

export const dynamic = 'force-dynamic';

/**
 * Settings → Company profile & branding.
 *
 * THE SINGLE SOURCE OF TRUTH for who the organisation is on generated
 * documents — close-out packs today, reports and communications as they arrive.
 * It reads and writes the existing CompanyConfig singleton rather than
 * introducing a second store, which is the whole point: a company name that
 * disagrees with itself across two screens is worse than one nobody can edit.
 *
 * TWO GATES, deliberately different — the same shape as Authentication &
 * Access:
 *   VIEW  — the Settings area gate (Director + Project Manager). A Project
 *           Manager can see what will appear on a pack they hand to a client.
 *   EDIT  — Director only, enforced again on the API. The read-only rendering
 *           below is a courtesy, not the permission.
 *
 * NOT per-project. The CDM duty holders on a job — client, principal designer,
 * principal contractor — are legal appointments that vary per project and live
 * on CdmDutyHolders. Nothing here feeds them.
 */
export default async function CompanyProfileSettingsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  const profile = await getPlatformCompanyProfile();

  return (
    <PlatformShell>
      <SettingsWorkspace active="company">
        <CompanyProfileSettings
          profile={profile}
          canEdit={canManageCompanyProfile(viewer.role)}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
