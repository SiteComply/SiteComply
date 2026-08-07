import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PrintButton } from '@/components/worker/PrintButton';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canGenerateCloseOutPack,
  renderPack,
} from '@/services/closeOut/closeOutService';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';
import { getCompanyBranding } from '@/services/company/companyConfigService';
import { collectAppendices } from '@/services/closeOut/closeOutArchive';
import { CloseOutPackDocument } from '@/components/platform/CloseOutPackDocument';
import { getCloseOutNarrativeMode } from '@/services/closeOut/closeOutNarrative';
import { CloseOutNarrativeControls } from '@/components/platform/CloseOutNarrativeControls';
import { readStoredNarrative } from '@/services/closeOut/closeOutAi';
import { canUseAiSummaries } from '@/services/ai/aiConfig';

export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 1 — the generated pack: cover page, contents, numbered sections.
 *
 * Printed with the browser (window.print), the same approach SC-019 Phase 2
 * used for the CPP — no PDF library is introduced. Server-side PDF and ZIP are
 * a later phase.
 *
 * The pack RE-READS live records and re-checks permissions on every view, so an
 * older version opened by a different person shows only what THEY may see.
 */
export default async function CloseOutPackPage({
  params,
}: {
  params: { id: string; packId: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canGenerateCloseOutPack(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const pack = await renderPack(viewer, params.packId);
  if (!pack) notFound();

  // Appendices are collected under the SAME viewer permissions as the pack, so
  // the appendix list can never name a file this person is not allowed to see.
  const [branding, { labels }, aiAvailable] = await Promise.all([
    getCompanyBranding(),
    collectAppendices(viewer, params.id),
    canUseAiSummaries(viewer.role),
  ]);

  // The stored narrative is re-validated against the sections THIS viewer can
  // see, so prose about a section they lost access to is dropped rather than
  // rendered from the stored copy.
  const narrative = readStoredNarrative(
    pack.aiSummary,
    pack.sections.map((sec) => sec.id),
  );

  return (
    <PlatformShell>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            {
              label: 'Close-out pack',
              href: `/platform/dashboard/sites/${params.id}/close-out`,
            },
            { label: `Version ${pack.version}.0` },
          ]}
        />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-1 text-2xl font-bold text-ink">{pack.title}</h1>
            <p className="text-ink-muted">
              Version {pack.version}.0 · generated{' '}
              {formatDateTimeUK(pack.generatedAt)} by {pack.generatedByName} · ~
              {pack.estimatedPages} pages
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/platform/dashboard/sites/${params.id}/close-out`}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              ← Back to generator
            </Link>
            <PrintButton label="Export as PDF (print)" />
          </div>
        </div>
      </div>

      {aiAvailable ? (
        <div className="mb-4 print:hidden">
          <CloseOutNarrativeControls
            siteId={params.id}
            packId={params.packId}
            hasNarrative={!!narrative}
            mode={getCloseOutNarrativeMode()}
          />
        </div>
      ) : null}

      <CloseOutPackDocument
        pack={pack}
        branding={branding}
        labels={labels}
        narrative={narrative}
      />
    </PlatformShell>
  );
}
