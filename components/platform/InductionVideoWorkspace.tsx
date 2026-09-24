import type { ReactNode } from 'react';
import { PageHeader } from '@/components/platform/PageHeader';
import { SectionWorkspace } from '@/components/platform/SectionWorkspace';

/**
 * The Induction Videos area as ONE workspace.
 *
 * ── WHY COMPANY MODULES MOVED HERE ────────────────────────────────────────
 *
 * They were in Platform → Settings, beside Management arrangements, on the
 * grounds that both are authored company content inherited by every project.
 * That analogy does not survive contact with the navigation: the construction
 * phase plan has no area of its own, so arrangements live in Settings by
 * necessity. Induction videos DO have an area, so modules were there by a
 * symmetry that does not hold.
 *
 * It also produced a real defect rather than just an awkward journey. A Site
 * Manager may draft a module, but the Settings nav entry is shown to Directors
 * and Project Managers only — so the one role that could draft and was not a
 * Director had no route to the screen at all and needed to be handed the URL.
 * This area's nav entry already includes Site Managers.
 *
 * ── WHAT THIS COMPONENT DOES NOT DECIDE ───────────────────────────────────
 *
 * Which sections exist is the caller's, exactly as in `SettingsWorkspace`:
 * presentation only, no permission evaluated here. A viewer who may not read
 * company modules is simply not passed that section, and the page behind it
 * keeps its own gate regardless — a navigator that hides a link is not an
 * access control.
 */
export interface InductionVideoArea {
  key: string;
  label: string;
  href: string;
  description: string;
}

export const INDUCTION_VIDEO_AREAS: InductionVideoArea[] = [
  {
    key: 'videos',
    label: 'Videos',
    href: '/platform/dashboard/induction-videos',
    description:
      'One row per project: which have an induction video, which are waiting on you, and which are missing information.',
  },
  {
    /*
     * Second, not first: a manager opens this area to work on a project's video,
     * and company content is what that video is partly built FROM. Putting the
     * company standard first would make the daily task the secondary one.
     */
    key: 'modules',
    label: 'Company modules',
    href: '/platform/dashboard/induction-videos/modules',
    description:
      'Standard content every induction carries, written once and issued centrally — included in every project alongside its own hazards and arrangements.',
  },
];

export function InductionVideoWorkspace({
  active,
  areas = INDUCTION_VIDEO_AREAS,
  breadcrumbs,
  children,
}: {
  active: string;
  /** Only the areas this viewer may see. Order is preserved. */
  areas?: InductionVideoArea[];
  breadcrumbs?: ReactNode;
  children: ReactNode;
}) {
  const current = areas.find((a) => a.key === active) ?? areas[0];
  const byKey = new Map(areas.map((a) => [a.key, a.href]));

  return (
    <>
      <PageHeader
        title="Induction videos"
        description="Built from each project’s own records, plus the standard content the company issues for every site."
        breadcrumbs={breadcrumbs}
      />

      <SectionWorkspace
        sections={areas.map((a) => ({
          key: a.key,
          label: a.label,
          description: a.description,
        }))}
        active={current?.key ?? ''}
        // Each area owns its own route, so the navigator links to it directly
        // rather than to a query on this one — the same reason SettingsWorkspace
        // looks an area up instead of building `?section=`.
        hrefFor={(key) => byKey.get(key) ?? areas[0]?.href ?? '#'}
        navLabel="Induction video areas"
      >
        {children}
      </SectionWorkspace>
    </>
  );
}
