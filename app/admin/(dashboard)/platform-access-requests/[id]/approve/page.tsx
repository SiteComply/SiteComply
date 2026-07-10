import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatUkMobileForDisplay } from '@/lib/phone';
import { AccessRequestApprovalForm } from '@/components/admin/AccessRequestApprovalForm';
import { getAccessRequestById } from '@/services/accessRequests/accessRequestService';
import { listSitesForAssignment } from '@/services/platformUsers/platformUserService';

export const dynamic = 'force-dynamic';

/**
 * Admin → approve a Platform Access Request. Pre-fills the requester's details,
 * lets the admin edit them, pick a role and assign sites, then creates and
 * activates the Platform User. Only PENDING requests can be approved here.
 */
export default async function ApproveAccessRequestPage({
  params,
}: {
  params: { id: string };
}) {
  const request = await getAccessRequestById(params.id);
  if (!request) notFound();
  if (request.status !== 'PENDING') {
    redirect(`/admin/platform-access-requests?status=${request.status}`);
  }

  const sites = await listSitesForAssignment();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/platform-access-requests"
          className="text-sm font-semibold text-brand-700"
        >
          ← Access Requests
        </Link>
        <h1 className="text-2xl font-bold text-ink">Approve access request</h1>
        <p className="text-ink-muted">
          Review and, if needed, edit the details below, choose a role and assign
          sites. Approving creates and activates the user — they can sign
          in straight away.
        </p>
      </header>

      <AccessRequestApprovalForm
        requestId={request.id}
        reason={request.reason}
        sites={sites}
        initial={{
          name: request.fullName,
          company: request.companyName,
          email: request.email,
          mobile: formatUkMobileForDisplay(request.mobile),
        }}
      />
    </div>
  );
}
