import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { ConfigTemplatesSection } from '@/components/platform/ConfigTemplatesSection';

export const dynamic = 'force-dynamic';

/**
 * Settings → Configuration templates.
 *
 * UX REFRESH PHASE 8 — the page body moved into ConfigTemplatesSection so the
 * Settings landing page can render the SAME area without duplicating its
 * loading. Every gate this page had is inside that section, unchanged; this file
 * only supplies the shell and says which area is active.
 *
 * NOTE the deliberate asymmetry with the other two settings routes: this one has
 * never redirected a non-manager away. It passes `canManage` down and renders
 * read-only instead. That is preserved — adding a redirect here would be a
 * permission change wearing a layout change's clothes.
 */
export default async function ConfigTemplatesPage() {
  return (
    <PlatformShell>
      <SettingsWorkspace active="config-templates">
        <ConfigTemplatesSection />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
