import type { ReactNode } from 'react';
import { PageHeader } from '@/components/platform/PageHeader';
import { SectionWorkspace } from '@/components/platform/SectionWorkspace';
import {
  INDUCTION_VIDEO_AREAS,
  INDUCTION_VIDEO_AREA_TITLE,
  inductionVideoHref,
  type InductionVideoArea,
} from '@/services/inductionVideo/inductionVideoAreas';

/*
 * The areas are NOT defined here any more. They are shared with the Admin Centre
 * so the two tiers cannot drift apart - see inductionVideoAreas.ts. Re-exported
 * because pages already import them from this component.
 */
export { INDUCTION_VIDEO_AREAS };
export type { InductionVideoArea };

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

  return (
    <>
      <PageHeader
        title={INDUCTION_VIDEO_AREA_TITLE}
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
        // rather than to a query on this one. The path comes from the shared
        // helper, so the Platform and the Admin Centre cannot disagree about
        // where an area lives.
        hrefFor={(key) =>
          inductionVideoHref('PLATFORM', key as InductionVideoArea['key'])
        }
        navLabel="Induction video areas"
      >
        {children}
      </SectionWorkspace>
    </>
  );
}
