import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { IdentityForm } from '@/components/checkin/IdentityForm';
import { cscsVerificationIsLive } from '@/services/cscs/cscsConfigService';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { formatUkMobileForDisplay } from '@/lib/phone';
import { toDateInputValue } from '@/lib/datetime';
import { nameNeedsChecking, openingFirstName } from '@/services/workers/workerName';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — step 2: capture name & company (and optional CSCS card).
 * Pre-fills from the existing worker record when the mobile is recognised.
 */
export default async function CheckInDetailsPage() {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  // Safety net for the same recognition the client performs after OTP: a worker
  // who is already checked in has nothing to answer here, however they arrived
  // (back button, bookmark, a stale tab). Deliberately NOT applied to
  // /check-in/site — a worker checked in at one site still needs that route to
  // check in at a second one.
  if (await getWorkerContext()) redirect('/worker/dashboard');

  const worker = await getWorkerByMobile(session.mobile);
  const verificationLive = await cscsVerificationIsLive();
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

      {/* CSCS cutover Phase 1 — the screen must not promise a check that is
          not going to happen, so the form is told whether one will. */}
      <IdentityForm
        recognised={recognised}
        verificationLive={verificationLive}
        checkName={worker ? nameNeedsChecking(worker) : false}
        initial={{
          // Opened, not parsed: the stored firstName where there is one, an EXACT
          // suffix match where a surname is known, and otherwise the whole existing
          // name for the worker to correct. See services/workers/workerName.ts.
          firstName: openingFirstName(worker ?? {}),
          // Empty for a returning worker who predates the field. NOT derived
          // from fullName: they are asked once, and stay unverified until they
          // answer — the owner's choice over guessing or backfilling.
          surname: worker?.surname ?? '',
          company: worker?.company ?? '',
          cscsCardNumber: worker?.cscsCardNumber ?? '',
          cscsCardType: worker?.cscsCardType ?? '',
          cscsSchemeId: worker?.cscsSchemeId ?? '',
          cscsExpiry: toDateInputValue(worker?.cscsExpiry ?? null),
        }}
      />
    </AppShell>
  );
}
