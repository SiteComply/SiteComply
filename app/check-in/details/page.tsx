import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { IdentityForm } from '@/components/checkin/IdentityForm';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { formatUkMobileForDisplay } from '@/lib/phone';
import { toDateInputValue } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — step 2: capture name & company (and optional CSCS card).
 * Pre-fills from the existing worker record when the mobile is recognised.
 */
export default async function CheckInDetailsPage() {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const worker = await getWorkerByMobile(session.mobile);
  const recognised = Boolean(worker);

  return (
    <AppShell>
      <Steps current="Your details" />
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">Your details</h1>
        <p className="text-sm text-ink-muted">
          Verified mobile: {formatUkMobileForDisplay(session.mobile)}
        </p>
      </header>

      <IdentityForm
        recognised={recognised}
        initial={{
          fullName: worker?.fullName ?? '',
          company: worker?.company ?? '',
          cscsCardNumber: worker?.cscsCardNumber ?? '',
          cscsCardType: worker?.cscsCardType ?? '',
          cscsExpiry: toDateInputValue(worker?.cscsExpiry ?? null),
        }}
      />
    </AppShell>
  );
}
