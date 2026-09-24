import type { ReactNode } from 'react';
import { AdminTabs } from '@/components/admin/AdminTabs';
import {
  INDUCTION_VIDEO_AREAS,
  INDUCTION_VIDEO_AREA_TITLE,
  inductionVideoAreaBase,
  inductionVideoHref,
  type InductionVideoAreaKey,
} from '@/services/inductionVideo/inductionVideoAreas';

/**
 * The Induction Videos area in the Admin Centre.
 *
 * ── THE SAME AREA, NOT A SETTINGS ITEM ────────────────────────────────────
 *
 * Company modules first arrived here as an entry under Settings, which was
 * functionally complete and structurally wrong: it read as a miscellaneous
 * setting rather than as part of the induction video product, and an administrator
 * arriving from the Platform found different words and a different shape.
 *
 * So this mirrors the Platform's workspace: the same area title, the same areas in
 * the same order with the same labels and the same one-line descriptions, all read
 * from `inductionVideoAreas.ts`. Nothing about the structure is retyped here, so
 * renaming an area or adding one reaches both tiers at once.
 *
 * ── WHY TABS HERE AND A SIDE NAVIGATOR THERE ──────────────────────────────
 *
 * The one thing deliberately not copied is the paint. The Admin Centre navigates
 * with `AdminTabs` everywhere and the Platform with `SectionWorkspace`; matching
 * the Platform's chrome inside the Admin shell would make this screen the only
 * one in its tier that looks foreign. Structure and terminology are shared, visual
 * language stays native to each tier.
 */
export function AdminInductionVideoWorkspace({
  active,
  children,
}: {
  active: InductionVideoAreaKey;
  children: ReactNode;
}) {
  const current = INDUCTION_VIDEO_AREAS.find((a) => a.key === active);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">{INDUCTION_VIDEO_AREA_TITLE}</h1>
        <p className="text-ink-muted">
          Built from each project’s own records, plus the standard content the
          company issues for every site.
        </p>
      </header>

      <AdminTabs
        label="Induction video areas"
        basePath={inductionVideoAreaBase('ADMIN')}
        active={active}
        tabs={INDUCTION_VIDEO_AREAS.map((a) => ({
          key: a.key,
          label: a.label,
          href: inductionVideoHref('ADMIN', a.key),
        }))}
      />

      {current && (
        <p className="text-sm text-ink-muted">{current.description}</p>
      )}

      {children}
    </div>
  );
}
