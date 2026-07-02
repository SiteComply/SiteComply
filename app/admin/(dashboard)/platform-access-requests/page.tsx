import Link from 'next/link';
import { AccessRequestStatus } from '@prisma/client';
import { cn } from '@/lib/cn';
import {
  AccessRequestList,
  type AccessRequestRow,
} from '@/components/admin/AccessRequestList';
import {
  listAccessRequests,
  accessRequestCounts,
} from '@/services/accessRequests/accessRequestService';

export const dynamic = 'force-dynamic';

const TABS: { status: AccessRequestStatus; label: string }[] = [
  { status: 'PENDING', label: 'Pending' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

/**
 * Admin → Platform Access Requests. Pending / Approved / Rejected tabs over the
 * self-service access requests. Pending requests can be approved or rejected.
 */
export default async function PlatformAccessRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const active: AccessRequestStatus =
    searchParams.status === 'APPROVED' || searchParams.status === 'REJECTED'
      ? searchParams.status
      : 'PENDING';

  const [requests, counts] = await Promise.all([
    listAccessRequests(active),
    accessRequestCounts(),
  ]);

  const rows: AccessRequestRow[] = requests.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    companyName: r.companyName,
    email: r.email,
    mobile: r.mobile,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewedBy: r.reviewedByAdmin?.displayName ?? null,
    linkedUserEmail: r.createdPlatformUser?.email ?? null,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Platform Access Requests</h1>
        <p className="text-ink-muted">
          Self-service access requests submitted from the platform sign-in
          screen. Approving a request creates and activates the{' '}
          <Link href="/admin/platform-users" className="font-semibold text-brand-700">
            Platform User
          </Link>{' '}
          automatically — no manual set-up needed — and they can sign in right
          away.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-line" aria-label="Request status">
        {TABS.map((tab) => {
          const isActive = tab.status === active;
          return (
            <Link
              key={tab.status}
              href={`/admin/platform-access-requests?status=${tab.status}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold',
                isActive
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'bg-surface-sunken text-ink-subtle',
                )}
              >
                {counts[tab.status]}
              </span>
            </Link>
          );
        })}
      </nav>

      <AccessRequestList requests={rows} />
    </div>
  );
}
