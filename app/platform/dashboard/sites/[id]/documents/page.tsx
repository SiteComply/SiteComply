import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import {
  Section,
  Empty,
  DocIssueRow,
} from '@/components/platform/siteDetailUi';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { countDocuments } from '@/services/documents/documentService';
import {
  DOCUMENT_EXPIRY_BADGE,
  DOCUMENT_EXPIRY_LABEL,
} from '@/services/documents/documentConstants';

export const dynamic = 'force-dynamic';

/** Platform → Site Details — Documents tab: document-compliance summary. */
export default async function SiteDocumentsPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!permits(viewer.role, 'documents', 'view')) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const [expiredDocs, expiringDocs] = await Promise.all([
    countDocuments(viewer, { siteId: params.id, expiry: 'expired' }),
    countDocuments(viewer, { siteId: params.id, expiry: 'expiring' }),
  ]);

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="documents" />

      <Section title="Documents">
        {expiredDocs === 0 && expiringDocs === 0 ? (
          <Empty>No document issues for this site.</Empty>
        ) : (
          <ul className="space-y-1">
            <DocIssueRow
              href={`/platform/dashboard/documents?site=${params.id}&expiry=expired`}
              label={DOCUMENT_EXPIRY_LABEL.EXPIRED}
              count={expiredDocs}
              badge={DOCUMENT_EXPIRY_BADGE.EXPIRED}
            />
            <DocIssueRow
              href={`/platform/dashboard/documents?site=${params.id}&expiry=expiring`}
              label={DOCUMENT_EXPIRY_LABEL.EXPIRING_SOON}
              count={expiringDocs}
              badge={DOCUMENT_EXPIRY_BADGE.EXPIRING_SOON}
            />
          </ul>
        )}
        <Link
          href={`/platform/dashboard/documents?site=${params.id}`}
          className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
        >
          View documents →
        </Link>
      </Section>
    </PlatformShell>
  );
}
