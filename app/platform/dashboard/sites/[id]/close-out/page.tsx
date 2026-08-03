import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { CloseOutPackWizard } from '@/components/platform/CloseOutPackWizard';
import { CloseOutArchiveButton } from '@/components/platform/CloseOutArchiveButton';
import { CloseOutSupportingUpload } from '@/components/platform/CloseOutSupportingUpload';
import { CloseOutShareManager } from '@/components/platform/CloseOutShareManager';
import { viewerCan } from '@/services/platformUsers/effectivePermissions';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canGenerateCloseOutPack,
  getSectionAvailability,
  listPacks,
} from '@/services/closeOut/closeOutService';
import { prisma } from '@/lib/prisma';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 1 — Project Close-Out Pack generator.
 *
 * Built to the REV-1 example's workflow: three steps, a section list with live
 * counts and ordering, and a cover-page preview alongside.
 */
export default async function CloseOutPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canGenerateCloseOutPack(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const [sections, packs, site] = await Promise.all([
    getSectionAvailability(viewer, params.id),
    listPacks(viewer, params.id),
    prisma.jobSite.findUnique({
      where: { id: params.id },
      select: {
        name: true,
        jobReference: true,
        addressLine1: true,
        addressLine2: true,
        town: true,
        postcode: true,
      },
    }),
  ]);
  if (!sections || !site) notFound();

  const address = [
    site.addressLine1,
    site.addressLine2,
    site.town,
    site.postcode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: site.name, href: `/platform/dashboard/sites/${params.id}` },
          { label: 'Close-out pack' },
        ]}
      />
      <div className="mb-5">
        <h1 className="mt-1 text-2xl font-bold text-ink">
          Project Close-Out Pack Generator
        </h1>
        <p className="text-ink-muted">
          Automatically compile all project records into a professional handover
          pack.
        </p>
      </div>

      <CloseOutPackWizard
        siteId={params.id}
        siteName={site.name}
        jobReference={site.jobReference}
        address={address}
        sections={sections}
        preparedBy={viewer.name}
      />

      {viewerCan(viewer, 'documents', 'create', params.id) ? (
        <CloseOutSupportingUpload siteId={params.id} />
      ) : null}

      {packs && packs.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-base font-bold text-ink">Revision history</h2>
          <p className="mb-3 text-sm text-ink-muted">
            Every generation is kept. Earlier versions stay exactly as they were
            generated.
          </p>
          <ul className="divide-y divide-line">
            {packs.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    Version {p.version}.0 — {p.title}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {p.sectionCount} sections · generated{' '}
                    {formatDateTimeUK(p.generatedAt)} by {p.generatedByName}
                    {p.preparedFor ? ` · for ${p.preparedFor}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={`/platform/dashboard/sites/${params.id}/close-out/${p.id}`}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    Open
                  </Link>
                  <CloseOutShareManager
                    siteId={params.id}
                    packId={p.id}
                    hasZip={!!p.zip}
                  />
                  <CloseOutArchiveButton
                    siteId={params.id}
                    packId={p.id}
                    zip={
                      p.zip
                        ? {
                            ...p.zip,
                            generatedAt: p.zip.generatedAt.toISOString(),
                          }
                        : null
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </PlatformShell>
  );
}
