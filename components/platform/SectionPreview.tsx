import { PlatformShell } from './PlatformShell';
import { PlatformIcon, type PlatformIconName } from './icons';
import type { PlatformModule } from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';

/**
 * Shared placeholder for Platform sections that are navigation-only for now.
 * Renders inside the PlatformShell and shows the viewer's site-access scope, so
 * it's clear the section will only ever cover the sites they may see (all sites
 * for a Director, otherwise their Assigned Sites).
 */
export async function SectionPreview({
  title,
  description,
  icon,
  module,
}: {
  title: string;
  description: string;
  icon: PlatformIconName;
  module: PlatformModule;
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, module);

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="text-ink-muted">{description}</p>
        </div>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {describeScope(viewer)}
        </span>
      </header>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <PlatformIcon name={icon} className="h-6 w-6" />
        </span>
        <h2 className="text-lg font-semibold text-ink">{title} — coming soon</h2>
        <p className="max-w-sm text-sm text-ink-muted">
          {viewer.allSites
            ? `The full ${title.toLowerCase()} experience is coming in a later stage. It will cover all sites across your organisation.`
            : viewer.siteIds.length === 0
              ? `The full ${title.toLowerCase()} experience is coming in a later stage. You have no sites assigned yet.`
              : `The full ${title.toLowerCase()} experience is coming in a later stage. It will only ever show data for your ${viewer.siteIds.length} assigned site${
                  viewer.siteIds.length === 1 ? '' : 's'
                }.`}
        </p>
      </div>
    </PlatformShell>
  );
}
