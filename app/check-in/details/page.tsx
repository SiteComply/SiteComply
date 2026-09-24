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
import { isCardFixRequest, shouldLeaveCheckInDetails } from '@/services/cscs/cardFixFlow';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — step 2: capture name & company (and optional CSCS card).
 * Pre-fills from the existing worker record when the mobile is recognised.
 */
export default async function CheckInDetailsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  /*
   * ARRIVED TO FIX A CARD? Then this screen is the destination, not a wrong
   * turn. See services/cscs/cardFixFlow.ts: the guard below used to send every
   * one of these people straight back where they came from, because the prompt
   * that sends them here only appears to workers who ARE checked in.
   */
  const fixingCard = isCardFixRequest(searchParams);

  // Safety net for the same recognition the client performs after OTP: a worker
  // who is already checked in has nothing to answer here, however they arrived
  // (back button, bookmark, a stale tab). Deliberately NOT applied to
  // /check-in/site — a worker checked in at one site still needs that route to
  // check in at a second one.
  if (shouldLeaveCheckInDetails(Boolean(await getWorkerContext()), fixingCard)) {
    redirect('/worker/dashboard');
  }

  const worker = await getWorkerByMobile(session.mobile);
  const verificationLive = await cscsVerificationIsLive();
  const recognised = Boolean(worker);

  return (
    <AppShell>
      {/* The step indicator counts the CHECK-IN journey. Someone fixing a card
          is already on site and is not walking it, so numbering them through it
          would be a lie about where they are. */}
      {!fixingCard && <Steps current="Your details" />}
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">
          {fixingCard ? 'Your card details' : 'Your details'}
        </h1>
        <p className="text-sm text-ink-muted">
          Verified mobile: {formatUkMobileForDisplay(session.mobile)}
        </p>
      </header>

      {fixingCard && (
        <p className="mb-4 rounded-xl bg-hivis-400/20 px-4 py-3 text-sm text-ink ring-1 ring-inset ring-hivis-500">
          Check the card details below and correct anything that is wrong, then
          save. We will check the card again straight away and show you the
          result.
        </p>
      )}

      {/* CSCS cutover Phase 1 — the screen must not promise a check that is
          not going to happen, so the form is told whether one will. */}
      <IdentityForm
        fixingCard={fixingCard}
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
