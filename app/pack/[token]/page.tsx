import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { PrintButton } from '@/components/worker/PrintButton';
import { CloseOutPackDocument } from '@/components/platform/CloseOutPackDocument';
import { getCompanyBranding } from '@/services/company/companyConfigService';
import { renderPack } from '@/services/closeOut/closeOutService';
import { collectAppendices } from '@/services/closeOut/closeOutArchive';
import { readStoredNarrative } from '@/services/closeOut/closeOutAi';
import {
  resolveShare,
  recordShareView,
  type ShareFailure,
} from '@/services/closeOut/closeOutSharing';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 3 — a close-out pack opened from a share link.
 *
 * No session. Access is the token, and the pack is rendered under the SHARER'S
 * CURRENT permissions (resolved live in `resolveShare`), so this page cannot
 * show anything the person who shared it could not show today.
 *
 * Search engines must never index a handover pack, hence the robots metadata —
 * a link pasted into a webmail preview or a chat client is enough for a crawler
 * to find it otherwise.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

const FAILURE_COPY: Record<ShareFailure, { title: string; body: string }> = {
  invalid: {
    title: 'This link is not valid',
    body: 'Check that you copied the whole link. If you were sent it by email, the link may have been split across two lines.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Share links are time-limited. Please ask your contact at the project for a new link.',
  },
  revoked: {
    title: 'This link has been withdrawn',
    body: 'The project team has revoked access to this pack. Please contact them if you still need it.',
  },
  sharer_lost_access: {
    title: 'This link is no longer available',
    body: 'The person who shared this pack no longer has access to the project, so the link has stopped working. Please ask the project team for a new one.',
  },
  forbidden: {
    title: 'This link is no longer available',
    body: 'Please contact the project team for access.',
  },
  not_found: {
    title: 'This pack could not be found',
    body: 'It may have been deleted. Please contact the project team.',
  },
};

function Refusal({ reason }: { reason: ShareFailure }) {
  const copy = FAILURE_COPY[reason];
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold text-ink">{copy.title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{copy.body}</p>
      </div>
    </main>
  );
}

export default async function SharedPackPage({
  params,
}: {
  params: { token: string };
}) {
  const resolved = await resolveShare(params.token);
  if (!resolved.ok) return <Refusal reason={resolved.reason} />;

  const { share } = resolved;
  const pack = await renderPack(share.viewer, share.packId);
  if (!pack) return <Refusal reason="not_found" />;

  const [branding, { labels }] = await Promise.all([
    getCompanyBranding(),
    collectAppendices(share.viewer, pack.siteId),
  ]);

  const narrative = readStoredNarrative(
    pack.aiSummary,
    pack.sections.map((s) => s.id),
  );

  // Logged after the pack resolves, so a refused attempt is not recorded as a
  // successful view. Never throws.
  const ip =
    headers().get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers().get('x-real-ip');
  await recordShareView(share.shareId, 'VIEW', ip ?? null);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              Shared with {share.label}
            </p>
            <p className="text-xs text-ink-subtle">
              Sent by {share.sharedByName} · access expires{' '}
              {formatDateUK(share.expiresAt)}
            </p>
          </div>
          <div className="flex gap-2">
            {share.includeZip ? (
              <a
                href={`/api/pack/${params.token}/zip`}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
              >
                Download ZIP
              </a>
            ) : null}
            <PrintButton label="Save as PDF (print)" />
          </div>
        </div>
      </div>

      <CloseOutPackDocument
        pack={pack}
        branding={branding}
        labels={labels}
        narrative={narrative}
      />
    </main>
  );
}
